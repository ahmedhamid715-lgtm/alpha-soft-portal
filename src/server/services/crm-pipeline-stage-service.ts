import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope } from "./crm-shared";
import { crmPipelineRepository } from "@/server/repositories/crm-pipeline-repository";
import { crmPipelineStageRepository } from "@/server/repositories/crm-pipeline-stage-repository";
import { NotFoundError, ValidationError } from "@/lib/errors/app-error";
import type { CrmPipelineStage } from "@/generated/prisma/client";

/**
 * Pipeline stage configuration — `crm.pipeline.manage` for mutations,
 * `crm.pipeline.read` for listing. Not separately audited (settings-
 * style CRUD, the same reasoning `crm-lead-source-service.ts` already
 * documents in Build 19) — stage configuration changes ARE, however,
 * visible for real business review through the stages themselves (no
 * hidden history needed for what's already a small, always-current
 * settings list).
 */

const STAGE_SORT_GAP = 1000;

async function assertOwnedPipeline(pipelineId: string, organizationId: string, tx: Parameters<typeof crmPipelineRepository.findById>[1]): Promise<void> {
  const pipeline = await crmPipelineRepository.findById(pipelineId, tx);
  if (!pipeline || pipeline.organizationId !== organizationId) throw new ValidationError("pipelineId does not reference a valid pipeline.");
}

const createStageSchema = z.object({
  pipelineId: z.string().uuid(),
  name: z.string().min(1).max(200),
  isWon: z.boolean().default(false),
  isLost: z.boolean().default(false),
  defaultProbability: z.number().int().min(0).max(100).nullable().optional(),
});

export async function createStage(rawInput: unknown): Promise<CrmPipelineStage> {
  const input = parseOrThrow(createStageSchema, rawInput);
  if (input.isWon && input.isLost) throw new ValidationError("A stage cannot be both isWon and isLost.");
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  return withTenantContext(tenantScope, async (tx) => {
    await assertOwnedPipeline(input.pipelineId, organizationId, tx);
    const existing = await crmPipelineStageRepository.listForPipeline(input.pipelineId, {}, tx);
    const maxSortOrder = existing.reduce((max, s) => Math.max(max, s.sortOrder), 0);

    return crmPipelineStageRepository.create(
      { id: generateId(), organizationId, pipelineId: input.pipelineId, name: input.name, sortOrder: maxSortOrder + STAGE_SORT_GAP, isWon: input.isWon, isLost: input.isLost, defaultProbability: input.defaultProbability ?? null },
      tx,
    );
  });
}

const listStagesSchema = z.object({ pipelineId: z.string().uuid(), status: z.enum(["ACTIVE", "ARCHIVED"]).optional() });

export async function listStagesForPipeline(rawInput: unknown): Promise<CrmPipelineStage[]> {
  const input = parseOrThrow(listStagesSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.read");

  return withTenantContext(tenantScope, async (tx) => {
    await assertOwnedPipeline(input.pipelineId, organizationId, tx);
    return crmPipelineStageRepository.listForPipeline(input.pipelineId, { status: input.status }, tx);
  });
}

const listStagesForPipelinesSchema = z.object({ pipelineIds: z.array(z.string().uuid()).min(1).max(200), status: z.enum(["ACTIVE", "ARCHIVED"]).optional() });

/**
 * Batched form of `listStagesForPipeline()` for a page rendering every
 * pipeline's own stages at once (the settings page's own "Sales
 * pipelines" section) — one auth resolution, one tenant transaction, one
 * query, instead of the N-of-each the settings page previously issued
 * per pipeline (a real per-pipeline N+1 found by Codex's own Build 20
 * Phase 8 performance review: ~17 SQL statements per pipeline). Callers
 * are expected to pass only pipeline IDs already returned by
 * `listPipelines()` for the same organization; RLS scopes the query
 * regardless, so no separate per-ID ownership check is performed here.
 */
export async function listStagesForPipelines(rawInput: unknown): Promise<Map<string, CrmPipelineStage[]>> {
  const input = parseOrThrow(listStagesForPipelinesSchema, rawInput);
  const { tenantScope } = await resolveCrmScope("crm.pipeline.read");

  return withTenantContext(tenantScope, async (tx) => {
    const stages = await crmPipelineStageRepository.listForPipelines(input.pipelineIds, { status: input.status }, tx);
    const byPipelineId = new Map<string, CrmPipelineStage[]>();
    for (const stage of stages) byPipelineId.set(stage.pipelineId, [...(byPipelineId.get(stage.pipelineId) ?? []), stage]);
    return byPipelineId;
  });
}

const updateStageSchema = z.object({
  stageId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
  defaultProbability: z.number().int().min(0).max(100).nullable().optional(),
});

export async function updateStage(rawInput: unknown): Promise<CrmPipelineStage> {
  const input = parseOrThrow(updateStageSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmPipelineStageRepository.findById(input.stageId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Stage");
    // Validated against the MERGED next state, not just the fields this
    // one request happens to include — confirmed by Codex's own Phase 5
    // security review (Build 20): checking only `input.isWon &&
    // input.isLost` let a caller flip one flag at a time (e.g.
    // `{isWon: true}` alone) and land on a stage that's already
    // `isLost: true`, silently producing a contradictory terminal stage.
    const nextIsWon = input.isWon ?? existing.isWon;
    const nextIsLost = input.isLost ?? existing.isLost;
    if (nextIsWon && nextIsLost) throw new ValidationError("A stage cannot be both isWon and isLost.");
    const { stageId, ...data } = input;
    return crmPipelineStageRepository.update(stageId, data, tx);
  });
}

const moveStageSchema = z.object({ stageId: z.string().uuid(), targetIndex: z.number().int().min(0) });

/**
 * Reorders one stage within its own pipeline to `targetIndex` (0-based,
 * among ACTIVE stages only — an archived stage keeps whatever `sortOrder`
 * it last had). Gap-based: computes the midpoint `sortOrder` between the
 * two real neighbors at the target position, so an ordinary single-move
 * touches exactly one row. Falls back to a full renumber (increments of
 * 1000, still just the stages in this one small pipeline, never a
 * mass-table operation) only when two neighbors have no integer gap left
 * between them — rare, since gaps start at 1000 and only shrink by
 * repeated moves into the exact same slot.
 */
export async function moveStage(rawInput: unknown): Promise<CrmPipelineStage> {
  const input = parseOrThrow(moveStageSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const moving = await crmPipelineStageRepository.findById(input.stageId, tx);
    if (!moving || moving.organizationId !== organizationId) throw new NotFoundError("Stage");

    const siblings = (await crmPipelineStageRepository.listForPipeline(moving.pipelineId, { status: "ACTIVE" }, tx)).filter((s) => s.id !== moving.id);
    const targetIndex = Math.min(input.targetIndex, siblings.length);
    const before = targetIndex > 0 ? siblings[targetIndex - 1] : null;
    const after = targetIndex < siblings.length ? siblings[targetIndex] : null;

    let newSortOrder: number;
    if (before && after) {
      newSortOrder = Math.floor((before.sortOrder + after.sortOrder) / 2);
      if (newSortOrder === before.sortOrder || newSortOrder === after.sortOrder) {
        const reordered = [...siblings.slice(0, targetIndex), moving, ...siblings.slice(targetIndex)];
        await crmPipelineStageRepository.renumber(moving.pipelineId, reordered.map((s) => s.id), tx);
        return (await crmPipelineStageRepository.findById(moving.id, tx))!;
      }
    } else if (after) {
      newSortOrder = after.sortOrder > STAGE_SORT_GAP ? Math.floor(after.sortOrder / 2) : after.sortOrder - 1;
    } else if (before) {
      newSortOrder = before.sortOrder + STAGE_SORT_GAP;
    } else {
      newSortOrder = STAGE_SORT_GAP;
    }

    return crmPipelineStageRepository.update(moving.id, { sortOrder: newSortOrder }, tx);
  });
}

const archiveStageSchema = z.object({ stageId: z.string().uuid() });

export async function archiveStage(rawInput: unknown): Promise<CrmPipelineStage> {
  const input = parseOrThrow(archiveStageSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmPipelineStageRepository.findById(input.stageId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Stage");
    return crmPipelineStageRepository.archive(input.stageId, tx);
  });
}

const reactivateStageSchema = z.object({ stageId: z.string().uuid() });

export async function reactivateStage(rawInput: unknown): Promise<CrmPipelineStage> {
  const input = parseOrThrow(reactivateStageSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmPipelineStageRepository.findById(input.stageId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Stage");
    return crmPipelineStageRepository.reactivate(input.stageId, tx);
  });
}
