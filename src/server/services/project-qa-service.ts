import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveProjectScope, lockMutableProject } from "./project-shared";
import { projectTaskRepository } from "@/server/repositories/project-task-repository";
import { milestoneRepository } from "@/server/repositories/milestone-repository";
import { projectQaCheckRepository } from "@/server/repositories/project-qa-check-repository";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { ProjectQaCheck } from "@/generated/prisma/client";

/**
 * Project QA checks (Build 27 — Roadmap Module 21) — `ProjectQaCheck`
 * scoped to a Project, or optionally further to one Task OR one
 * Milestone (never both — the DB CHECK constraint enforces the mutual
 * exclusivity, mirrored here for a clean `ValidationError`). Creating a
 * check needs `delivery_projects.manage`; recording an outcome needs the
 * SEPARATE `delivery_projects.qa` authority (real separation of duties —
 * see permissions.ts's own comment).
 */

const createQaCheckSchema = z
  .object({ projectId: z.string().uuid(), taskId: z.string().uuid().nullable().optional(), milestoneId: z.string().uuid().nullable().optional(), title: z.string().trim().min(1).max(200), required: z.boolean().default(true) })
  .refine((v) => !(v.taskId && v.milestoneId), { message: "A QA check may target a task OR a milestone, never both." });

export async function createQaCheck(rawInput: unknown): Promise<ProjectQaCheck> {
  const input = parseOrThrow(createQaCheckSchema, rawInput);
  const { tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  return withTenantContext(tenantScope, async (tx) => {
    await lockMutableProject(input.projectId, organizationId, tx);
    if (input.taskId) {
      const task = await projectTaskRepository.findById(input.taskId, tx);
      if (!task || task.projectId !== input.projectId) throw new ValidationError("taskId does not belong to this project.");
    }
    if (input.milestoneId) {
      const milestone = await milestoneRepository.findById(input.milestoneId, tx);
      if (!milestone || milestone.projectId !== input.projectId) throw new ValidationError("milestoneId does not belong to this project.");
    }
    return projectQaCheckRepository.create({ id: generateId(), organizationId, projectId: input.projectId, taskId: input.taskId ?? null, milestoneId: input.milestoneId ?? null, title: input.title, required: input.required }, tx);
  });
}

const recordQaCheckSchema = z.object({ qaCheckId: z.string().uuid(), status: z.enum(["PASSED", "FAILED", "WAIVED"]), notes: z.string().trim().max(2000).nullable().optional() });

export async function recordQaCheck(rawInput: unknown): Promise<ProjectQaCheck> {
  const input = parseOrThrow(recordQaCheckSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.qa");

  const qaCheck = await withTenantContext(tenantScope, async (tx) => {
    const existing = await projectQaCheckRepository.findById(input.qaCheckId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("QA check");
    if (existing.status !== "PENDING") throw new ValidationError("This QA check has already been recorded.");
    const updated = await projectQaCheckRepository.record(input.qaCheckId, { status: input.status, checkedByUserId: context.user!.id, checkedAt: new Date(), notes: input.notes ?? null }, tx);
    if (!updated) throw new ConflictError("This QA check was just recorded by someone else.");
    return updated;
  });

  await audit
    .recordSuccess({
      action: "projects.qa_decided",
      organizationId,
      resourceType: "project_qa_check",
      resourceId: qaCheck.id,
      resourceName: qaCheck.title,
      metadata: { status: input.status, notes: input.notes ?? null },
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record projects.qa_decided", error));

  return qaCheck;
}
