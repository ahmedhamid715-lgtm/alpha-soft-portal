import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope } from "./crm-shared";
import { crmPipelineRepository } from "@/server/repositories/crm-pipeline-repository";
import { crmPipelineStageRepository } from "@/server/repositories/crm-pipeline-stage-repository";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError } from "@/lib/errors/app-error";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { CrmPipeline } from "@/generated/prisma/client";

/**
 * Sales Pipeline configuration (Build 20 — Roadmap Module 14) —
 * `crm.pipeline.manage` for every mutation, `crm.pipeline.read` for
 * listing. Mirrors `crm-company-service.ts`'s own shape: parse ->
 * authorize -> short `withTenantContext()` transaction -> audit.
 *
 * The DEFAULT stage set every new pipeline seeds is defined here, not
 * hard-coded elsewhere (spec's own "do not hard-code pipeline stages
 * globally into application logic") — it's a one-time convenience at
 * creation time, freely editable afterward via `crm-pipeline-stage-
 * service.ts`.
 */

const DEFAULT_STAGES: { name: string; defaultProbability: number | null; isWon?: boolean; isLost?: boolean }[] = [
  { name: "New", defaultProbability: 10 },
  { name: "Qualifying", defaultProbability: 25 },
  { name: "Proposal", defaultProbability: 50 },
  { name: "Negotiation", defaultProbability: 75 },
  { name: "Closed Won", defaultProbability: 100, isWon: true },
  { name: "Closed Lost", defaultProbability: 0, isLost: true },
];
const STAGE_SORT_GAP = 1000;

async function auditPipelineCreated(context: AuthorizationContext, organizationId: string, pipelineId: string, name: string): Promise<void> {
  await audit
    .recordSuccess({ action: "crm.pipeline.created", organizationId, resourceType: "crm_pipeline", resourceId: pipelineId, resourceName: name, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record crm.pipeline.created", error));
}

async function auditPipelineArchived(context: AuthorizationContext, organizationId: string, pipelineId: string): Promise<void> {
  await audit
    .recordSuccess({ action: "crm.pipeline.archived", organizationId, resourceType: "crm_pipeline", resourceId: pipelineId, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record crm.pipeline.archived", error));
}

const createPipelineSchema = z.object({ name: z.string().min(1).max(200), isDefault: z.boolean().default(false), seedDefaultStages: z.boolean().default(true) });

/** Creates a pipeline and, unless `seedDefaultStages` is false, its default 6-stage set. `isDefault: true` is rejected with a clear error (not a raw DB conflict) if another pipeline already holds it — this organization's "at most one default" invariant is real DB-enforced, but callers deserve a real `ConflictError`-shaped message, not a bare unique-violation string. */
export async function createPipeline(rawInput: unknown): Promise<CrmPipeline> {
  const input = parseOrThrow(createPipelineSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  const pipeline = await withTenantContext(tenantScope, async (tx) => {
    if (input.isDefault) {
      const existingDefault = await crmPipelineRepository.findDefault(organizationId, tx);
      if (existingDefault) throw new ValidationError(`"${existingDefault.name}" is already the default pipeline. Unset it first.`);
    }

    const id = generateId();
    const created = await crmPipelineRepository.create({ id, organizationId, name: input.name, isDefault: input.isDefault }, tx);

    if (input.seedDefaultStages) {
      for (const [index, stage] of DEFAULT_STAGES.entries()) {
        await crmPipelineStageRepository.create(
          { id: generateId(), organizationId, pipelineId: id, name: stage.name, sortOrder: (index + 1) * STAGE_SORT_GAP, isWon: stage.isWon, isLost: stage.isLost, defaultProbability: stage.defaultProbability },
          tx,
        );
      }
    }

    return created;
  });

  await auditPipelineCreated(context, organizationId, pipeline.id, input.name);
  return pipeline;
}

const listPipelinesSchema = z.object({ status: z.enum(["ACTIVE", "ARCHIVED"]).optional() });

export async function listPipelines(rawInput: unknown = {}): Promise<CrmPipeline[]> {
  const input = parseOrThrow(listPipelinesSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.read");
  return withTenantContext(tenantScope, (tx) => crmPipelineRepository.listForOrganization(organizationId, { status: input.status }, tx));
}

const getPipelineSchema = z.object({ pipelineId: z.string().uuid() });

export async function getPipeline(rawInput: unknown): Promise<CrmPipeline> {
  const input = parseOrThrow(getPipelineSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.read");

  const pipeline = await withTenantContext(tenantScope, (tx) => crmPipelineRepository.findById(input.pipelineId, tx));
  if (!pipeline) throw new NotFoundError("Pipeline");
  if (pipeline.organizationId !== organizationId) throw new NotFoundError("Pipeline");
  return pipeline;
}

/** The pipeline the board opens to by default — the org's own `isDefault` pipeline if one exists and is active, else the oldest ACTIVE pipeline, else `null` (no pipelines configured yet). */
export async function getDefaultPipeline(): Promise<CrmPipeline | null> {
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.read");
  return withTenantContext(tenantScope, async (tx) => {
    const active = await crmPipelineRepository.listForOrganization(organizationId, { status: "ACTIVE" }, tx);
    return active.find((p) => p.isDefault) ?? active[0] ?? null;
  });
}

const updatePipelineSchema = z.object({ pipelineId: z.string().uuid(), name: z.string().min(1).max(200).optional(), isDefault: z.boolean().optional() });

export async function updatePipeline(rawInput: unknown): Promise<CrmPipeline> {
  const input = parseOrThrow(updatePipelineSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmPipelineRepository.findById(input.pipelineId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Pipeline");

    if (input.isDefault === true && !existing.isDefault) {
      const existingDefault = await crmPipelineRepository.findDefault(organizationId, tx);
      if (existingDefault && existingDefault.id !== input.pipelineId) {
        // Atomic hand-off, not "reject and ask the caller to unset it
        // first" (unlike creation, where there's no existing pipeline
        // to juggle) — clearing the old default and setting the new one
        // in the same transaction is the actually useful behavior here.
        await crmPipelineRepository.update(existingDefault.id, { isDefault: false }, tx);
      }
    }

    const { pipelineId, ...data } = input;
    return crmPipelineRepository.update(pipelineId, data, tx);
  });
}

const archivePipelineSchema = z.object({ pipelineId: z.string().uuid() });

export async function archivePipeline(rawInput: unknown): Promise<CrmPipeline> {
  const input = parseOrThrow(archivePipelineSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  const archived = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmPipelineRepository.findById(input.pipelineId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Pipeline");
    return crmPipelineRepository.archive(input.pipelineId, tx);
  });

  await auditPipelineArchived(context, organizationId, input.pipelineId);
  return archived;
}

const reactivatePipelineSchema = z.object({ pipelineId: z.string().uuid() });

export async function reactivatePipeline(rawInput: unknown): Promise<CrmPipeline> {
  const input = parseOrThrow(reactivatePipelineSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmPipelineRepository.findById(input.pipelineId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Pipeline");
    return crmPipelineRepository.reactivate(input.pipelineId, tx);
  });
}
