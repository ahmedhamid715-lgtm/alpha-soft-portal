import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope, assertPlatformStaffMember } from "./crm-shared";
import { crmDealRepository, type CrmDealListFilters, type CrmDealWithRelations } from "@/server/repositories/crm-deal-repository";
import { crmDealHistoryRepository, type CrmDealHistoryWithActor } from "@/server/repositories/crm-deal-history-repository";
import { crmPipelineRepository } from "@/server/repositories/crm-pipeline-repository";
import { crmPipelineStageRepository } from "@/server/repositories/crm-pipeline-stage-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { crmContactRepository } from "@/server/repositories/crm-contact-repository";
import { crmLeadRepository } from "@/server/repositories/crm-lead-repository";
import { crmActivityRepository } from "@/server/repositories/crm-activity-repository";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import { type OffsetPaginationParams, type OffsetPaginatedResult } from "@/lib/platform/pagination";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { CrmDeal, CrmDealHistory, CrmPipelineStage, Prisma } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";
import { db } from "@/lib/db/client";

/**
 * Sales deal lifecycle (Build 20 — Roadmap Module 14) — `crm.pipeline.manage`
 * for mutations, `crm.pipeline.read` for listing/viewing.
 *
 * Lifecycle authority: `CrmDeal.status` (OPEN/WON/LOST), never bare stage
 * membership — see sales-pipeline.md "Won/lost semantics." An ordinary
 * `moveDealStage()` REJECTS any target stage flagged `isWon`/`isLost`;
 * only `winDeal()`/`loseDeal()` may move a deal into one, and only
 * `reopenDeal()` may move a WON/LOST deal at all. Every transition is a
 * real compare-and-swap at the repository layer (`crmDealRepository`'s
 * own `moveStage`/`win`/`lose`/`reopen`) — a lost race surfaces here as
 * a `ConflictError`, never a silent overwrite.
 */

/**
 * `.length(3)` alone (the original schema) accepted anything three
 * characters long — `"12!"`, digits, punctuation — which `formatMoney()`
 * (`Intl.NumberFormat` with that string as `currency`) then throws a
 * `RangeError` on when rendering the deal. Confirmed by Codex's own
 * Phase 5 security review (Build 20). Three letters, normalized to
 * uppercase, matches `src/lib/utils/money.ts`'s own ISO 4217 assumption
 * without hard-coding one fixed currency list here.
 */
const currencyCodeSchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/, "currency must be a 3-letter ISO 4217 code.")
  .transform((v) => v.toUpperCase());

interface CrmDealAssignedPayload {
  dealId: string;
  organizationId: string;
  assignedToUserId: string;
  title: string;
}

async function emitDealAssigned(deal: CrmDeal): Promise<void> {
  await events.emit<CrmDealAssignedPayload>("crm.deal.assigned", { dealId: deal.id, organizationId: deal.organizationId, assignedToUserId: deal.assignedToUserId!, title: deal.title });
}

async function auditDealCreated(context: AuthorizationContext, organizationId: string, dealId: string, title: string): Promise<void> {
  await audit
    .recordSuccess({ action: "crm.deal.created", organizationId, resourceType: "crm_deal", resourceId: dealId, resourceName: title, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record crm.deal.created", error));
}

async function auditDealOwnerChanged(context: AuthorizationContext, organizationId: string, dealId: string): Promise<void> {
  await audit
    .recordSuccess({ action: "crm.deal.owner_changed", organizationId, resourceType: "crm_deal", resourceId: dealId, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record crm.deal.owner_changed", error));
}

async function auditDealTransition(context: AuthorizationContext, action: "crm.deal.won" | "crm.deal.lost" | "crm.deal.reopened", organizationId: string, dealId: string): Promise<void> {
  await audit
    .recordSuccess({ action, organizationId, resourceType: "crm_deal", resourceId: dealId, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error(`[audit] failed to record ${action}`, error));
}

function logHistory(
  organizationId: string,
  dealId: string,
  actorUserId: string,
  type: "CREATED" | "STAGE_CHANGED" | "VALUE_CHANGED" | "PROBABILITY_CHANGED" | "EXPECTED_CLOSE_DATE_CHANGED" | "OWNER_CHANGED" | "WON" | "LOST" | "REOPENED" | "NOTE",
  metadata: Record<string, unknown> | undefined,
  note: string | null,
  tx: TransactionClient | typeof db,
): Promise<unknown> {
  return crmDealHistoryRepository.create({ id: generateId(), organizationId, dealId, type, metadata: metadata as Prisma.InputJsonValue | undefined, note, actorUserId }, tx);
}

/**
 * `requireActivePipeline`/`requireActiveStage` default to `true` for
 * every real caller — placing or moving a deal into an ARCHIVED
 * pipeline/stage is a real configuration-hygiene gap, confirmed by
 * Codex's own Phase 5 security review (Build 20): a `crm.pipeline.manage`
 * holder could otherwise hide open deals from the board (which only
 * ever renders ACTIVE stages) by moving them into a just-archived
 * stage, or create new deals against retired configuration. `win`/`lose`
 * pass `false` for the STAGE check specifically, since they resolve
 * their own target stage separately (see their own callers below) —
 * this function still validates the pipeline itself is active there.
 */
async function assertOwnedPipelineAndStage(
  pipelineId: string,
  stageId: string,
  organizationId: string,
  companyId: string | undefined,
  tx: TransactionClient | typeof db,
  options: { requireActivePipeline?: boolean; requireActiveStage?: boolean } = {},
): Promise<{ pipeline: NonNullable<Awaited<ReturnType<typeof crmPipelineRepository.findById>>>; stage: CrmPipelineStage }> {
  const { requireActivePipeline = true, requireActiveStage = true } = options;
  const pipeline = await crmPipelineRepository.findById(pipelineId, tx);
  if (!pipeline || pipeline.organizationId !== organizationId) throw new ValidationError("pipelineId does not reference a valid pipeline.");
  if (requireActivePipeline && pipeline.status !== "ACTIVE") throw new ValidationError("This pipeline is archived — reactivate it before placing deals in it.");
  const stage = await crmPipelineStageRepository.findById(stageId, tx);
  if (!stage || stage.organizationId !== organizationId || stage.pipelineId !== pipelineId) throw new ValidationError("stageId does not reference a valid stage in this pipeline.");
  if (requireActiveStage && stage.status !== "ACTIVE") throw new ValidationError("This stage is archived — reactivate it or choose a different stage.");
  if (companyId) {
    const company = await crmCompanyRepository.findById(companyId, tx);
    if (!company || company.organizationId !== organizationId) throw new ValidationError("companyId does not reference a valid company.");
  }
  return { pipeline, stage };
}

const createDealSchema = z.object({
  pipelineId: z.string().uuid(),
  stageId: z.string().uuid().optional(),
  companyId: z.string().uuid(),
  primaryContactId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200),
  valueMinorUnits: z.number().int().min(0).default(0),
  currency: currencyCodeSchema.default("USD"),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  expectedCloseDate: z.coerce.date().nullable().optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
});

export async function createDeal(rawInput: unknown): Promise<CrmDeal> {
  const input = parseOrThrow(createDealSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  const deal = await withTenantContext(tenantScope, async (tx) => {
    const stages = await crmPipelineStageRepository.listForPipeline(input.pipelineId, { status: "ACTIVE" }, tx);
    const stageId = input.stageId ?? stages.find((s) => !s.isWon && !s.isLost)?.id;
    if (!stageId) throw new ValidationError("This pipeline has no open stage to place a new deal in.");

    const { stage } = await assertOwnedPipelineAndStage(input.pipelineId, stageId, organizationId, input.companyId, tx);
    if (stage.isWon || stage.isLost) throw new ValidationError("A new deal cannot start in a Won/Lost stage — use winDeal()/loseDeal() after creating it.");

    if (input.primaryContactId) {
      const contact = await crmContactRepository.findById(input.primaryContactId, tx);
      if (!contact || contact.organizationId !== organizationId || contact.companyId !== input.companyId) {
        throw new ValidationError("primaryContactId must reference a contact belonging to the same company.");
      }
    }
    if (input.assignedToUserId) await assertPlatformStaffMember(input.assignedToUserId, organizationId, tx);

    const probability = input.probability ?? stage.defaultProbability ?? null;
    const id = generateId();
    const created = await crmDealRepository.create(
      {
        id,
        organizationId,
        pipelineId: input.pipelineId,
        stageId,
        companyId: input.companyId,
        primaryContactId: input.primaryContactId ?? null,
        sourceLeadId: null,
        title: input.title,
        valueMinorUnits: input.valueMinorUnits,
        currency: input.currency.toUpperCase(),
        probability,
        expectedCloseDate: input.expectedCloseDate ?? null,
        assignedToUserId: input.assignedToUserId ?? null,
      },
      tx,
    );
    await logHistory(organizationId, id, context.user!.id, "CREATED", { title: input.title }, null, tx);
    return created;
  });

  await auditDealCreated(context, organizationId, deal.id, input.title);
  if (deal.assignedToUserId) await emitDealAssigned(deal);
  return deal;
}

const listDealsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  status: z.enum(["OPEN", "WON", "LOST"]).optional(),
  companyId: z.string().uuid().optional(),
  assignedToUserId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});

export async function listDeals(rawInput: unknown): Promise<OffsetPaginatedResult<CrmDeal>> {
  const input = parseOrThrow(listDealsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.read");
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };
  const filters: CrmDealListFilters = { pipelineId: input.pipelineId, stageId: input.stageId, status: input.status, companyId: input.companyId, assignedToUserId: input.assignedToUserId, search: input.search };

  return withTenantContext(tenantScope, (tx) => crmDealRepository.listForOrganization(organizationId, params, filters, tx));
}

const listBoardSchema = z.object({ pipelineId: z.string().uuid() });

/** Every OPEN deal in one pipeline, for the Kanban board — see `crmDealRepository.listOpenForPipeline()`'s own bound. */
export async function listOpenDealsForBoard(rawInput: unknown): Promise<CrmDealWithRelations[]> {
  const input = parseOrThrow(listBoardSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.read");

  return withTenantContext(tenantScope, async (tx) => {
    const pipeline = await crmPipelineRepository.findById(input.pipelineId, tx);
    if (!pipeline || pipeline.organizationId !== organizationId) throw new NotFoundError("Pipeline");
    return crmDealRepository.listOpenForPipeline(organizationId, input.pipelineId, tx);
  });
}

const getDealSchema = z.object({ dealId: z.string().uuid() });

export async function getDeal(rawInput: unknown): Promise<CrmDeal> {
  const input = parseOrThrow(getDealSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.read");

  const deal = await withTenantContext(tenantScope, (tx) => crmDealRepository.findById(input.dealId, tx));
  if (!deal) throw new NotFoundError("Deal");
  if (deal.organizationId !== organizationId) throw new NotFoundError("Deal");
  return deal;
}

export async function getDealWithRelations(rawInput: unknown): Promise<CrmDealWithRelations> {
  const input = parseOrThrow(getDealSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.read");

  const deal = await withTenantContext(tenantScope, (tx) => crmDealRepository.findByIdWithRelations(input.dealId, tx));
  if (!deal) throw new NotFoundError("Deal");
  if (deal.organizationId !== organizationId) throw new NotFoundError("Deal");
  return deal;
}

const updateDealSchema = z.object({
  dealId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  valueMinorUnits: z.number().int().min(0).optional(),
  currency: currencyCodeSchema.optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  expectedCloseDate: z.coerce.date().nullable().optional(),
  primaryContactId: z.string().uuid().nullable().optional(),
});

/** Logs one `CrmDealHistory` entry per CHANGED field (never a full-row diff) — see sales-pipeline.md "Deal history." Lifecycle fields (`status`/`stageId`) are never accepted here; they only ever move through `moveDealStage()`/`winDeal()`/`loseDeal()`/`reopenDeal()`. */
export async function updateDeal(rawInput: unknown): Promise<CrmDeal> {
  const input = parseOrThrow(updateDealSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmDealRepository.findById(input.dealId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Deal");

    if (input.primaryContactId) {
      const contact = await crmContactRepository.findById(input.primaryContactId, tx);
      if (!contact || contact.organizationId !== organizationId || contact.companyId !== existing.companyId) {
        throw new ValidationError("primaryContactId must reference a contact belonging to this deal's company.");
      }
    }
    if (input.currency && input.currency.toUpperCase() !== existing.currency && input.valueMinorUnits === undefined) {
      // Changing currency without also re-stating the value is almost
      // always a mistake (the old minor-units amount means something
      // entirely different in a new currency) — require both together.
      throw new ValidationError("Changing currency requires also providing valueMinorUnits in the same call.");
    }

    const { dealId, ...data } = input;
    const updated = await crmDealRepository.update(dealId, { ...data, currency: input.currency?.toUpperCase() }, tx);

    if (input.valueMinorUnits !== undefined && (input.valueMinorUnits !== existing.valueMinorUnits || input.currency?.toUpperCase() !== existing.currency)) {
      await logHistory(organizationId, dealId, context.user!.id, "VALUE_CHANGED", { fromMinorUnits: existing.valueMinorUnits, toMinorUnits: input.valueMinorUnits, currency: input.currency?.toUpperCase() ?? existing.currency }, null, tx);
    }
    if ("probability" in input && input.probability !== existing.probability) {
      await logHistory(organizationId, dealId, context.user!.id, "PROBABILITY_CHANGED", { from: existing.probability, to: input.probability }, null, tx);
    }
    if ("expectedCloseDate" in input && input.expectedCloseDate?.getTime() !== existing.expectedCloseDate?.getTime()) {
      await logHistory(organizationId, dealId, context.user!.id, "EXPECTED_CLOSE_DATE_CHANGED", { from: existing.expectedCloseDate, to: input.expectedCloseDate }, null, tx);
    }

    return updated;
  });
}

const moveDealStageSchema = z.object({ dealId: z.string().uuid(), stageId: z.string().uuid() });

export async function moveDealStage(rawInput: unknown): Promise<CrmDeal> {
  const input = parseOrThrow(moveDealStageSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  const deal = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmDealRepository.findById(input.dealId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Deal");
    if (existing.status !== "OPEN") throw new ValidationError("Only an OPEN deal can move between stages — reopen it first.");

    const { stage } = await assertOwnedPipelineAndStage(existing.pipelineId, input.stageId, organizationId, undefined, tx);
    if (stage.isWon || stage.isLost) throw new ValidationError("Cannot move a deal into a Won/Lost stage directly — use winDeal()/loseDeal().");
    if (stage.id === existing.stageId) return existing;

    const updated = await crmDealRepository.moveStage(input.dealId, input.stageId, existing.stageId, tx);
    if (!updated) throw new ConflictError("This deal's stage was just changed by someone else. Reload and try again.");
    await logHistory(organizationId, input.dealId, context.user!.id, "STAGE_CHANGED", { from: existing.stageId, to: input.stageId }, null, tx);
    return updated;
  });

  return deal;
}

const winDealSchema = z.object({ dealId: z.string().uuid(), stageId: z.string().uuid().optional() });

export async function winDeal(rawInput: unknown): Promise<CrmDeal> {
  const input = parseOrThrow(winDealSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  const deal = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmDealRepository.findById(input.dealId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Deal");
    if (existing.status !== "OPEN") throw new ValidationError("Only an OPEN deal can be won.");

    const stages = await crmPipelineStageRepository.listForPipeline(existing.pipelineId, { status: "ACTIVE" }, tx);
    const wonStageId = input.stageId ?? stages.find((s) => s.isWon)?.id;
    if (!wonStageId) throw new ValidationError("This pipeline has no active stage flagged as Won — configure one in pipeline settings first.");
    const wonStage = stages.find((s) => s.id === wonStageId);
    if (!wonStage || !wonStage.isWon) throw new ValidationError("stageId must reference an active stage flagged isWon in this deal's own pipeline.");

    const updated = await crmDealRepository.win(input.dealId, wonStageId, tx);
    if (!updated) throw new ConflictError("This deal was just changed by someone else. Reload and try again.");
    await logHistory(organizationId, input.dealId, context.user!.id, "WON", { stageId: wonStageId }, null, tx);
    return updated;
  });

  await auditDealTransition(context, "crm.deal.won", organizationId, input.dealId);
  return deal;
}

const loseDealSchema = z.object({ dealId: z.string().uuid(), stageId: z.string().uuid().optional(), lossReason: z.string().min(1).max(1000) });

export async function loseDeal(rawInput: unknown): Promise<CrmDeal> {
  const input = parseOrThrow(loseDealSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  const deal = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmDealRepository.findById(input.dealId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Deal");
    if (existing.status !== "OPEN") throw new ValidationError("Only an OPEN deal can be lost.");

    const stages = await crmPipelineStageRepository.listForPipeline(existing.pipelineId, { status: "ACTIVE" }, tx);
    const lostStageId = input.stageId ?? stages.find((s) => s.isLost)?.id;
    if (!lostStageId) throw new ValidationError("This pipeline has no active stage flagged as Lost — configure one in pipeline settings first.");
    const lostStage = stages.find((s) => s.id === lostStageId);
    if (!lostStage || !lostStage.isLost) throw new ValidationError("stageId must reference an active stage flagged isLost in this deal's own pipeline.");

    const updated = await crmDealRepository.lose(input.dealId, lostStageId, input.lossReason, tx);
    if (!updated) throw new ConflictError("This deal was just changed by someone else. Reload and try again.");
    await logHistory(organizationId, input.dealId, context.user!.id, "LOST", { stageId: lostStageId, lossReason: input.lossReason }, null, tx);
    return updated;
  });

  await auditDealTransition(context, "crm.deal.lost", organizationId, input.dealId);
  return deal;
}

const reopenDealSchema = z.object({ dealId: z.string().uuid(), targetStageId: z.string().uuid().optional() });

export async function reopenDeal(rawInput: unknown): Promise<CrmDeal> {
  const input = parseOrThrow(reopenDealSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  const deal = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmDealRepository.findById(input.dealId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Deal");
    if (existing.status !== "WON" && existing.status !== "LOST") throw new ValidationError("Only a WON or LOST deal can be reopened.");

    let targetStageId = input.targetStageId;
    if (targetStageId) {
      const { stage } = await assertOwnedPipelineAndStage(existing.pipelineId, targetStageId, organizationId, undefined, tx);
      if (stage.isWon || stage.isLost) throw new ValidationError("Cannot reopen a deal directly into a Won/Lost stage.");
    } else {
      const stages = await crmPipelineStageRepository.listForPipeline(existing.pipelineId, { status: "ACTIVE" }, tx);
      const firstOpenStage = stages.find((s) => !s.isWon && !s.isLost);
      if (!firstOpenStage) throw new ValidationError("This pipeline has no open stage to reopen into — configure one in pipeline settings first.");
      targetStageId = firstOpenStage.id;
    }

    const expectedStatus = existing.status as "WON" | "LOST";
    const updated = await crmDealRepository.reopen(input.dealId, targetStageId, expectedStatus, tx);
    if (!updated) throw new ConflictError("This deal was just changed by someone else. Reload and try again.");
    await logHistory(organizationId, input.dealId, context.user!.id, "REOPENED", { fromStatus: expectedStatus, stageId: targetStageId }, null, tx);
    return updated;
  });

  await auditDealTransition(context, "crm.deal.reopened", organizationId, input.dealId);
  return deal;
}

const changeDealOwnerSchema = z.object({ dealId: z.string().uuid(), assignedToUserId: z.string().uuid().nullable() });

export async function changeDealOwner(rawInput: unknown): Promise<CrmDeal> {
  const input = parseOrThrow(changeDealOwnerSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  const deal = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmDealRepository.findById(input.dealId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Deal");
    if (input.assignedToUserId) await assertPlatformStaffMember(input.assignedToUserId, organizationId, tx);

    const updated = await crmDealRepository.changeOwner(input.dealId, input.assignedToUserId, tx);
    await logHistory(organizationId, input.dealId, context.user!.id, "OWNER_CHANGED", { from: existing.assignedToUserId, to: input.assignedToUserId }, null, tx);
    return updated;
  });

  await auditDealOwnerChanged(context, organizationId, input.dealId);
  if (deal.assignedToUserId) await emitDealAssigned(deal);
  return deal;
}

const logDealNoteSchema = z.object({ dealId: z.string().uuid(), note: z.string().min(1).max(4000) });

export async function logDealNote(rawInput: unknown): Promise<CrmDealHistory> {
  const input = parseOrThrow(logDealNoteSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmDealRepository.findById(input.dealId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Deal");
    return crmDealHistoryRepository.create({ id: generateId(), organizationId, dealId: input.dealId, type: "NOTE", metadata: undefined, note: input.note, actorUserId: context.user!.id }, tx);
  });
}

const listDealHistorySchema = z.object({ dealId: z.string().uuid(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });

export async function listDealHistory(rawInput: unknown): Promise<OffsetPaginatedResult<CrmDealHistoryWithActor>> {
  const input = parseOrThrow(listDealHistorySchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.read");
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };

  return withTenantContext(tenantScope, async (tx) => {
    const deal = await crmDealRepository.findById(input.dealId, tx);
    if (!deal || deal.organizationId !== organizationId) throw new NotFoundError("Deal");
    return crmDealHistoryRepository.listForDeal(input.dealId, params, tx);
  });
}

const convertLeadToDealSchema = z.object({
  leadId: z.string().uuid(),
  pipelineId: z.string().uuid(),
  stageId: z.string().uuid().optional(),
  title: z.string().min(1).max(200).optional(),
  valueMinorUnits: z.number().int().min(0).default(0),
  currency: currencyCodeSchema.default("USD"),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  expectedCloseDate: z.coerce.date().nullable().optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
});

/**
 * Converts a QUALIFIED `CrmLead` into a `CrmDeal` — the one explicit
 * lead-to-deal boundary this module defines (see sales-pipeline.md
 * "Lead -> deal behavior"). Requires BOTH `crm.manage` (to transition
 * the lead) and `crm.pipeline.manage` (to create the deal) — a real,
 * proportionate requirement, not an accident: this action genuinely
 * spans both domains, and both permissions are already co-granted to
 * the same platform_owner/platform_admin roles.
 *
 * Deliberately calls `crmLeadRepository.changeStatus()` and
 * `crmActivityRepository.create()` directly — the same repository-level
 * calls `crm-lead-service.ts`'s own `changeLeadStatus()` makes — rather
 * than calling that service function itself, which would open its OWN
 * separate `withTenantContext()` transaction and break the atomicity
 * this operation needs (the lead's CONVERTED transition and the new
 * deal's creation must commit or fail together). This reuses Build 19's
 * exact state-machine mechanics without duplicating them; only the
 * transaction boundary differs.
 */
export async function convertLeadToDeal(rawInput: unknown): Promise<CrmDeal> {
  const input = parseOrThrow(convertLeadToDealSchema, rawInput);
  const crmContext = await resolveCrmScope("crm.manage");
  const pipelineContext = await resolveCrmScope("crm.pipeline.manage");
  const { context, tenantScope, organizationId } = pipelineContext;

  const deal = await withTenantContext(tenantScope, async (tx) => {
    const lead = await crmLeadRepository.findById(input.leadId, tx);
    if (!lead || lead.organizationId !== organizationId) throw new NotFoundError("Lead");
    if (lead.status !== "QUALIFIED") throw new ValidationError(`Only a QUALIFIED lead can be converted to a deal (this lead is ${lead.status}).`);

    const stages = await crmPipelineStageRepository.listForPipeline(input.pipelineId, { status: "ACTIVE" }, tx);
    const stageId = input.stageId ?? stages.find((s) => !s.isWon && !s.isLost)?.id;
    if (!stageId) throw new ValidationError("This pipeline has no open stage to place a new deal in.");
    const { stage } = await assertOwnedPipelineAndStage(input.pipelineId, stageId, organizationId, lead.companyId, tx);
    if (stage.isWon || stage.isLost) throw new ValidationError("A new deal cannot start in a Won/Lost stage.");

    if (input.assignedToUserId) await assertPlatformStaffMember(input.assignedToUserId, organizationId, tx);

    // Reused Build 19 mechanics — see this function's own doc comment.
    const updatedLead = await crmLeadRepository.changeStatus(input.leadId, "CONVERTED", "QUALIFIED", { convertedAt: new Date() }, tx);
    if (!updatedLead) throw new ConflictError("This lead's status was just changed by someone else. Reload and try again.");
    await crmActivityRepository.create(
      { id: generateId(), organizationId, leadId: input.leadId, companyId: null, contactId: null, type: "STATUS_CHANGE", body: `Status changed from QUALIFIED to CONVERTED`, callDurationSeconds: null, callOutcome: null, actorUserId: crmContext.context.user!.id },
      tx,
    );

    const id = generateId();
    const probability = input.probability ?? stage.defaultProbability ?? null;
    const created = await crmDealRepository.create(
      {
        id,
        organizationId,
        pipelineId: input.pipelineId,
        stageId,
        companyId: lead.companyId,
        primaryContactId: lead.primaryContactId,
        sourceLeadId: input.leadId,
        title: input.title ?? lead.title,
        valueMinorUnits: input.valueMinorUnits,
        currency: input.currency.toUpperCase(),
        probability,
        expectedCloseDate: input.expectedCloseDate ?? null,
        assignedToUserId: input.assignedToUserId ?? null,
      },
      tx,
    );
    await logHistory(organizationId, id, context.user!.id, "CREATED", { title: created.title, sourceLeadId: input.leadId }, null, tx);
    return created;
  });

  await audit
    .recordSuccess({ action: "crm.lead.status_changed", organizationId, resourceType: "crm_lead", resourceId: input.leadId, previousState: { status: "QUALIFIED" }, newState: { status: "CONVERTED" }, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record crm.lead.status_changed", error));
  await audit
    .recordSuccess({ action: "crm.lead.converted", organizationId, resourceType: "crm_lead", resourceId: input.leadId, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record crm.lead.converted", error));
  await auditDealCreated(context, organizationId, deal.id, deal.title);
  if (deal.assignedToUserId) await emitDealAssigned(deal);
  return deal;
}
