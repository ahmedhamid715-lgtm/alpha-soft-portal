import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveProjectScope, lockMutableProject } from "./project-shared";
import { listUsersWithPermission } from "./crm-shared";
import { projectRepository } from "@/server/repositories/project-repository";
import { milestoneRepository } from "@/server/repositories/milestone-repository";
import { projectApprovalRepository } from "@/server/repositories/project-approval-repository";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError, AuthorizationError } from "@/lib/errors/app-error";
import type { ProjectApproval } from "@/generated/prisma/client";

/**
 * Project/Milestone approvals (Build 27 — Roadmap Module 21) — a narrow,
 * PROJECT-specific record, never a reusable global approval workflow
 * engine (that's Roadmap Module 67; see project-management.md "Approvals
 * vs. Roadmap Module 67"). Requesting needs `delivery_projects.manage`; deciding
 * needs the SEPARATE `delivery_projects.approve` authority. Self-approval is
 * rejected at BOTH this service layer AND a DB CHECK
 * (`requested_by_user_id != approver_user_id`) — defense in depth, not
 * merely a UI restriction.
 */

interface ProjectApprovalRequestedPayload {
  approvalId: string;
  projectId: string;
  organizationId: string;
  recipientUserId: string;
  projectTitle: string;
  resourceLabel: string;
}
interface ProjectApprovalCompletedPayload {
  approvalId: string;
  projectId: string;
  organizationId: string;
  recipientUserId: string;
  projectTitle: string;
  resourceLabel: string;
  approved: boolean;
}

async function resolveResourceLabel(resourceType: "PROJECT" | "MILESTONE", resourceId: string, projectId: string, tx: Parameters<typeof milestoneRepository.findById>[1]): Promise<string> {
  if (resourceType === "PROJECT") {
    if (resourceId !== projectId) throw new ValidationError("A PROJECT-scoped approval's resourceId must equal projectId.");
    const project = await projectRepository.findById(projectId, tx);
    if (!project) throw new NotFoundError("Project");
    return project.title;
  }
  const milestone = await milestoneRepository.findById(resourceId, tx);
  if (!milestone || milestone.projectId !== projectId) throw new ValidationError("resourceId does not reference a milestone belonging to this project.");
  return milestone.title;
}

const requestApprovalSchema = z.object({
  projectId: z.string().uuid(),
  resourceType: z.enum(["PROJECT", "MILESTONE"]),
  resourceId: z.string().uuid(),
  visibility: z.enum(["INTERNAL", "CUSTOMER_VISIBLE"]).default("INTERNAL"),
});

export async function requestApproval(rawInput: unknown): Promise<ProjectApproval> {
  const input = parseOrThrow(requestApprovalSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  const { approval, project, resourceLabel } = await withTenantContext(tenantScope, async (tx) => {
    const project = await lockMutableProject(input.projectId, organizationId, tx);
    const resourceLabel = await resolveResourceLabel(input.resourceType, input.resourceId, input.projectId, tx);
    const approval = await projectApprovalRepository.create(
      { id: generateId(), organizationId, projectId: input.projectId, resourceType: input.resourceType, resourceId: input.resourceId, requestedByUserId: context.user!.id, visibility: input.visibility },
      tx,
    );
    return { approval, project, resourceLabel };
  });

  const approvers = await listUsersWithPermission("delivery_projects.approve", organizationId);
  for (const approver of approvers) {
    if (approver.id === approval.requestedByUserId) continue; // never notify the requester as if they were an approver they can't act as (self-approval is rejected at decide-time anyway, but there's no reason to notify them here)
    await events.emit<ProjectApprovalRequestedPayload>("projects.approval_requested", { approvalId: approval.id, projectId: project.id, organizationId, recipientUserId: approver.id, projectTitle: project.title, resourceLabel });
  }
  return approval;
}

const decideApprovalSchema = z
  .object({ approvalId: z.string().uuid(), decision: z.enum(["APPROVED", "REJECTED"]), reason: z.string().trim().max(1000).nullable().optional() })
  .refine((v) => v.decision !== "REJECTED" || (v.reason && v.reason.trim().length > 0), { message: "A reason is required to reject an approval.", path: ["reason"] });

export async function decideApproval(rawInput: unknown): Promise<ProjectApproval> {
  const input = parseOrThrow(decideApprovalSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.approve");

  const { approval, project, resourceLabel } = await withTenantContext(tenantScope, async (tx) => {
    const existing = await projectApprovalRepository.findById(input.approvalId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Approval");
    if (existing.requestedByUserId === context.user!.id) throw new AuthorizationError("You cannot decide an approval you yourself requested.");
    if (existing.status !== "PENDING") throw new ValidationError("This approval has already been decided.");

    const project = await projectRepository.findById(existing.projectId, tx);
    if (!project) throw new NotFoundError("Project");
    const resourceLabel = await resolveResourceLabel(existing.resourceType, existing.resourceId, existing.projectId, tx);

    const approval = await projectApprovalRepository.decide(input.approvalId, { status: input.decision, approverUserId: context.user!.id, decidedAt: new Date(), reason: input.reason ?? null }, tx);
    if (!approval) throw new ConflictError("This approval was just decided by someone else.");
    return { approval, project, resourceLabel };
  });

  await audit
    .recordSuccess({
      action: "projects.approval_decided",
      organizationId,
      resourceType: "project_approval",
      resourceId: approval.id,
      resourceName: resourceLabel,
      metadata: { decision: input.decision, reason: input.reason ?? null },
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record projects.approval_decided", error));

  await events.emit<ProjectApprovalCompletedPayload>("projects.approval_completed", {
    approvalId: approval.id,
    projectId: project.id,
    organizationId,
    recipientUserId: approval.requestedByUserId,
    projectTitle: project.title,
    resourceLabel,
    approved: input.decision === "APPROVED",
  });
  return approval;
}
