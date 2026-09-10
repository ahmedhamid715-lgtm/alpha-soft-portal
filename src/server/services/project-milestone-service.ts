import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveProjectScope, lockMutableProject } from "./project-shared";
import { milestoneRepository } from "@/server/repositories/milestone-repository";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ConflictError } from "@/lib/errors/app-error";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { Milestone } from "@/generated/prisma/client";

/**
 * Milestone CRUD + reordering (Build 27 — Roadmap Module 21). Gap-based
 * `sortOrder`, the exact same algorithm `crm-pipeline-stage-service.ts`'s
 * own `moveStage()` establishes (Build 20) — an ordinary single move
 * touches exactly one row; a full renumber only when two neighbors have
 * no integer gap left. No stored status/progress here — see the
 * `Milestone` model's own schema comment; progress is always derived
 * server-side from child `ProjectTask` rows (`src/lib/projects/progress.ts`).
 */

const MILESTONE_SORT_GAP = 1000;

async function auditMilestone(context: AuthorizationContext, organizationId: string, milestone: Milestone, metadata?: Record<string, unknown>): Promise<void> {
  await audit
    .recordSuccess({ action: "projects.milestone_changed", organizationId, resourceType: "milestone", resourceId: milestone.id, resourceName: milestone.title, metadata, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record projects.milestone_changed", error));
}

const createMilestoneSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  targetDate: z.coerce.date().nullable().optional(),
  customerVisible: z.boolean().default(false),
});

export async function createMilestone(rawInput: unknown): Promise<Milestone> {
  const input = parseOrThrow(createMilestoneSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  const milestone = await withTenantContext(tenantScope, async (tx) => {
    await lockMutableProject(input.projectId, organizationId, tx);
    const existing = await milestoneRepository.listForProject(input.projectId, tx);
    const maxSortOrder = existing.reduce((max, m) => Math.max(max, m.sortOrder), 0);
    return milestoneRepository.create(
      { id: generateId(), organizationId, projectId: input.projectId, title: input.title, description: input.description ?? null, sortOrder: maxSortOrder + MILESTONE_SORT_GAP, targetDate: input.targetDate ?? null, customerVisible: input.customerVisible, createdByUserId: context.user!.id },
      tx,
    );
  });

  await auditMilestone(context, organizationId, milestone, { action: "created" });
  return milestone;
}

const updateMilestoneSchema = z.object({
  milestoneId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  targetDate: z.coerce.date().nullable().optional(),
  customerVisible: z.boolean().optional(),
});

export async function updateMilestone(rawInput: unknown): Promise<Milestone> {
  const input = parseOrThrow(updateMilestoneSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  const milestone = await withTenantContext(tenantScope, async (tx) => {
    const existing = await milestoneRepository.findById(input.milestoneId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Milestone");
    const { milestoneId, ...data } = input;
    return milestoneRepository.update(milestoneId, data, tx);
  });

  await auditMilestone(context, organizationId, milestone, { action: "updated" });
  return milestone;
}

const moveMilestoneSchema = z.object({ milestoneId: z.string().uuid(), targetIndex: z.number().int().min(0) });

/** Reorders one milestone within its own project to `targetIndex` (0-based). See `crm-pipeline-stage-service.ts`'s own `moveStage()` for the identical algorithm this mirrors. */
export async function moveMilestone(rawInput: unknown): Promise<Milestone> {
  const input = parseOrThrow(moveMilestoneSchema, rawInput);
  const { tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const moving = await milestoneRepository.findById(input.milestoneId, tx);
    if (!moving || moving.organizationId !== organizationId) throw new NotFoundError("Milestone");

    const siblings = (await milestoneRepository.listForProject(moving.projectId, tx)).filter((m) => m.id !== moving.id);
    const targetIndex = Math.min(input.targetIndex, siblings.length);
    const before = targetIndex > 0 ? siblings[targetIndex - 1] : null;
    const after = targetIndex < siblings.length ? siblings[targetIndex] : null;

    let newSortOrder: number;
    if (before && after) {
      newSortOrder = Math.floor((before.sortOrder + after.sortOrder) / 2);
      if (newSortOrder === before.sortOrder || newSortOrder === after.sortOrder) {
        const reordered = [...siblings.slice(0, targetIndex), moving, ...siblings.slice(targetIndex)];
        for (let i = 0; i < reordered.length; i += 1) await milestoneRepository.update(reordered[i]!.id, { sortOrder: (i + 1) * MILESTONE_SORT_GAP }, tx);
        return (await milestoneRepository.findById(moving.id, tx))!;
      }
    } else if (after) {
      newSortOrder = after.sortOrder > MILESTONE_SORT_GAP ? Math.floor(after.sortOrder / 2) : after.sortOrder - 1;
    } else if (before) {
      newSortOrder = before.sortOrder + MILESTONE_SORT_GAP;
    } else {
      newSortOrder = MILESTONE_SORT_GAP;
    }

    return milestoneRepository.update(moving.id, { sortOrder: newSortOrder }, tx);
  });
}

const cancelMilestoneSchema = z.object({ milestoneId: z.string().uuid(), reason: z.string().trim().min(1, "A reason is required.").max(1000) });

export async function cancelMilestone(rawInput: unknown): Promise<Milestone> {
  const input = parseOrThrow(cancelMilestoneSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  const milestone = await withTenantContext(tenantScope, async (tx) => {
    const existing = await milestoneRepository.findById(input.milestoneId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Milestone");
    await lockMutableProject(existing.projectId, organizationId, tx);
    const updated = await milestoneRepository.cancel(input.milestoneId, { cancelledAt: new Date(), cancelledReason: input.reason, cancelledByUserId: context.user!.id }, tx);
    if (!updated) throw new ConflictError("This milestone was already cancelled.");
    return updated;
  });

  await auditMilestone(context, organizationId, milestone, { action: "cancelled", reason: input.reason });
  return milestone;
}
