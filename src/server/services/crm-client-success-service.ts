import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope, assertPlatformStaffMember } from "./crm-shared";
import { crmClientSuccessProfileRepository } from "@/server/repositories/crm-client-success-profile-repository";
import {
  crmClientSuccessRenewalRepository,
  type CrmClientSuccessRenewalWithRelations,
  CLIENT_SUCCESS_RENEWAL_TERMINAL_STATUSES,
} from "@/server/repositories/crm-client-success-renewal-repository";
import {
  crmClientSuccessExpansionRepository,
  type CrmClientSuccessExpansionWithRelations,
  CLIENT_SUCCESS_EXPANSION_TERMINAL_STATUSES,
} from "@/server/repositories/crm-client-success-expansion-repository";
import { crmContractRepository } from "@/server/repositories/crm-contract-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { crmDealRepository } from "@/server/repositories/crm-deal-repository";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { CrmClientSuccessProfile, CrmClientSuccessRenewal, CrmClientSuccessExpansionOpportunity, CrmClientSuccessRenewalStatus, CrmClientSuccessExpansionStatus } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Client Success mutations (Build 25 — Roadmap Module 19) — CS
 * ownership, the management-attention flag, and the renewal/expansion
 * lifecycles. All gated by `crm.client_success.manage`. Read-only
 * listings are gated by `crm.client_success.read`. See
 * `crm-client-success-health-service.ts` for the (separate) computed
 * health/risk composition — this file owns only genuinely persisted
 * state.
 */

async function auditClientSuccess(
  context: AuthorizationContext,
  action:
    | "crm.client_success.owner_changed"
    | "crm.client_success.attention_flag_set"
    | "crm.client_success.attention_flag_cleared"
    | "crm.client_success.renewal_created"
    | "crm.client_success.renewal_status_changed"
    | "crm.client_success.expansion_identified"
    | "crm.client_success.expansion_status_changed"
    | "crm.client_success.expansion_handed_to_sales"
    | "crm.client_success.expansion_dismissed",
  organizationId: string,
  resourceType: string,
  resourceId: string,
  resourceName: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await audit
    .recordSuccess({ action, organizationId, resourceType, resourceId, resourceName, metadata, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error(`[audit] failed to record ${action}`, error));
}

// --- CS ownership --------------------------------------------------------

const setOwnerSchema = z.object({ companyId: z.string().uuid(), userId: z.string().uuid().nullable() });

export async function setClientSuccessOwner(rawInput: unknown): Promise<CrmClientSuccessProfile> {
  const input = parseOrThrow(setOwnerSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.client_success.manage");

  const { profile, companyName } = await withTenantContext(tenantScope, async (tx) => {
    const company = await getCompanyOrThrow(input.companyId, organizationId, tx);
    if (input.userId) await assertPlatformStaffMember(input.userId, organizationId, tx);
    const profile = await crmClientSuccessProfileRepository.setOwner({ id: generateId(), organizationId, companyId: input.companyId, csOwnerUserId: input.userId }, tx);
    return { profile, companyName: company.name };
  });

  await auditClientSuccess(context, "crm.client_success.owner_changed", organizationId, "crm_client_success_profile", input.companyId, companyName, { newOwnerUserId: input.userId });
  if (input.userId) {
    await events.emit<{ companyId: string; organizationId: string; recipientUserId: string; companyName: string }>("crm.client_success.owner_assigned", { companyId: input.companyId, organizationId, recipientUserId: input.userId, companyName });
  }
  return profile;
}

const setAttentionSchema = z
  .object({ companyId: z.string().uuid(), flag: z.boolean(), reason: z.string().trim().max(1000).nullable().optional() })
  .refine((v) => !v.flag || (v.reason && v.reason.length > 0), { message: "A reason is required when setting the management-attention flag.", path: ["reason"] });

/** The one manual signal this build allows — a flag, never a numeric health override (see client-success.md "Manual overrides"). */
export async function setManagementAttentionFlag(rawInput: unknown): Promise<CrmClientSuccessProfile> {
  const input = parseOrThrow(setAttentionSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.client_success.manage");

  const { profile, companyName } = await withTenantContext(tenantScope, async (tx) => {
    const company = await getCompanyOrThrow(input.companyId, organizationId, tx);
    const profile = await crmClientSuccessProfileRepository.setManagementAttention(
      { id: generateId(), organizationId, companyId: input.companyId, flag: input.flag, reason: input.flag ? (input.reason ?? null) : null, setByUserId: context.user!.id, setAt: new Date() },
      tx,
    );
    return { profile, companyName: company.name };
  });

  await auditClientSuccess(context, input.flag ? "crm.client_success.attention_flag_set" : "crm.client_success.attention_flag_cleared", organizationId, "crm_client_success_profile", input.companyId, companyName, { reason: input.reason ?? null });
  return profile;
}

/** `getCompany()`'s own tenant-scoped lookup opens its own `withTenantContext`, which this module is already inside — goes straight to the repository instead, the same way `getCustomer360()` does for its own root resolution. */
async function getCompanyOrThrow(companyId: string, organizationId: string, tx: TransactionClient) {
  const company = await crmCompanyRepository.findById(companyId, tx);
  if (!company || company.organizationId !== organizationId) throw new NotFoundError("Company");
  return company;
}

// --- Renewals --------------------------------------------------------------

const createRenewalSchema = z.object({
  companyId: z.string().uuid(),
  contractId: z.string().uuid(),
  /** Defaults to the contract's own `endDate` when omitted — never fabricated (see client-success.md "Renewal tracking"). */
  renewalDate: z.coerce.date().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  expectedValueMinorUnits: z.number().int().min(0).optional(),
  expectedValueCurrency: z.string().length(3).optional(),
  notes: z.string().max(2000).nullable().optional(),
}).refine((v) => (v.expectedValueMinorUnits === undefined) === (v.expectedValueCurrency === undefined), { message: "expectedValueMinorUnits and expectedValueCurrency must be provided together.", path: ["expectedValueCurrency"] });

export async function createRenewal(rawInput: unknown): Promise<CrmClientSuccessRenewal> {
  const input = parseOrThrow(createRenewalSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.client_success.manage");

  const { renewal, companyName } = await withTenantContext(tenantScope, async (tx) => {
    const company = await getCompanyOrThrow(input.companyId, organizationId, tx);
    const contract = await crmContractRepository.findById(input.contractId, tx);
    if (!contract || contract.organizationId !== organizationId) throw new NotFoundError("Contract");
    // Defense in depth beyond the DB's own relationship-integrity
    // trigger — never trust a resolved row's ownership without
    // re-checking it, the same discipline every service in this
    // codebase already establishes.
    if (contract.companyId !== input.companyId) throw new ValidationError("contractId must reference a contract belonging to this same company.");

    const existingOpen = await crmClientSuccessRenewalRepository.findOpenForContract(input.contractId, tx);
    if (existingOpen) throw new ConflictError("This contract already has an open (UPCOMING or IN_PROGRESS) renewal.");

    const renewalDate = input.renewalDate ?? contract.endDate;
    if (!renewalDate) throw new ValidationError("This contract has no endDate — a renewal date must be provided explicitly.");

    if (input.ownerUserId) await assertPlatformStaffMember(input.ownerUserId, organizationId, tx);

    const renewal = await crmClientSuccessRenewalRepository.create(
      {
        id: generateId(),
        organizationId,
        companyId: input.companyId,
        contractId: input.contractId,
        renewalDate,
        ownerUserId: input.ownerUserId ?? null,
        expectedValueMinorUnits: input.expectedValueMinorUnits ?? null,
        expectedValueCurrency: input.expectedValueCurrency ?? null,
        notes: input.notes ?? null,
        createdByUserId: context.user!.id,
      },
      tx,
    );
    return { renewal, companyName: company.name };
  });

  await auditClientSuccess(context, "crm.client_success.renewal_created", organizationId, "crm_client_success_renewal", renewal.id, companyName);
  if (input.ownerUserId) {
    await events.emit<{ renewalId: string; organizationId: string; recipientUserId: string; companyName: string; renewalDate: string }>("crm.client_success.renewal_owner_assigned", {
      renewalId: renewal.id,
      organizationId,
      recipientUserId: input.ownerUserId,
      companyName,
      renewalDate: renewal.renewalDate.toISOString().slice(0, 10),
    });
  }
  return renewal;
}

const listRenewalsSchema = z.object({ companyId: z.string().uuid() });

export async function listRenewalsForCompany(rawInput: unknown): Promise<CrmClientSuccessRenewalWithRelations[]> {
  const input = parseOrThrow(listRenewalsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.client_success.read");
  return withTenantContext(tenantScope, async (tx) => {
    await getCompanyOrThrow(input.companyId, organizationId, tx);
    return crmClientSuccessRenewalRepository.listForCompany(input.companyId, tx);
  });
}

const updateRenewalSchema = z.object({
  renewalId: z.string().uuid(),
  renewalDate: z.coerce.date().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  expectedValueMinorUnits: z.number().int().min(0).nullable().optional(),
  expectedValueCurrency: z.string().length(3).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function updateRenewal(rawInput: unknown): Promise<CrmClientSuccessRenewal> {
  const input = parseOrThrow(updateRenewalSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.client_success.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmClientSuccessRenewalRepository.findById(input.renewalId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Renewal");
    if (CLIENT_SUCCESS_RENEWAL_TERMINAL_STATUSES.includes(existing.status)) throw new ValidationError("This renewal has already reached a terminal state and can no longer be edited.");
    if (input.ownerUserId) await assertPlatformStaffMember(input.ownerUserId, organizationId, tx);
    const updated = await crmClientSuccessRenewalRepository.update(
      input.renewalId,
      { renewalDate: input.renewalDate, ownerUserId: input.ownerUserId, expectedValueMinorUnits: input.expectedValueMinorUnits, expectedValueCurrency: input.expectedValueCurrency, notes: input.notes },
      tx,
    );
    if (!updated) throw new ConflictError("This renewal was closed by another request just now.");
    return updated;
  });
}

const startRenewalSchema = z.object({ renewalId: z.string().uuid() });

export async function startRenewal(rawInput: unknown): Promise<CrmClientSuccessRenewal> {
  const input = parseOrThrow(startRenewalSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.client_success.manage");
  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmClientSuccessRenewalRepository.findById(input.renewalId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Renewal");
    if (existing.status !== "UPCOMING") throw new ValidationError("Only an UPCOMING renewal can be moved to IN_PROGRESS.");
    const updated = await crmClientSuccessRenewalRepository.setInProgress(input.renewalId, tx);
    if (!updated) throw new ConflictError("This renewal was closed by another request just now.");
    return updated;
  });
}

const closeRenewalSchema = z.object({ renewalId: z.string().uuid(), status: z.enum(["RENEWED", "NOT_RENEWING", "EXPIRED"]), outcome: z.string().trim().min(1).max(2000) });

export async function closeRenewal(rawInput: unknown): Promise<CrmClientSuccessRenewal> {
  const input = parseOrThrow(closeRenewalSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.client_success.manage");

  const renewal = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmClientSuccessRenewalRepository.findById(input.renewalId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Renewal");
    const updated = await crmClientSuccessRenewalRepository.transitionTerminal(input.renewalId, ["UPCOMING", "IN_PROGRESS"], { status: input.status as CrmClientSuccessRenewalStatus, outcome: input.outcome }, tx);
    if (!updated) throw new ConflictError("This renewal has already reached a terminal state.");
    return updated;
  });

  await auditClientSuccess(context, "crm.client_success.renewal_status_changed", organizationId, "crm_client_success_renewal", renewal.id, `Renewal -> ${input.status}`, { status: input.status, outcome: input.outcome });
  return renewal;
}

// --- Expansion opportunities ------------------------------------------------

const createExpansionSchema = z.object({
  companyId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  rationale: z.string().trim().min(1).max(2000),
  estimatedValueMinorUnits: z.number().int().min(0).optional(),
  estimatedValueCurrency: z.string().length(3).optional(),
  sourceSignal: z.string().trim().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
}).refine((v) => (v.estimatedValueMinorUnits === undefined) === (v.estimatedValueCurrency === undefined), { message: "estimatedValueMinorUnits and estimatedValueCurrency must be provided together.", path: ["estimatedValueCurrency"] });

export async function createExpansionOpportunity(rawInput: unknown): Promise<CrmClientSuccessExpansionOpportunity> {
  const input = parseOrThrow(createExpansionSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.client_success.manage");

  const { expansion, companyName } = await withTenantContext(tenantScope, async (tx) => {
    const company = await getCompanyOrThrow(input.companyId, organizationId, tx);
    if (input.ownerUserId) await assertPlatformStaffMember(input.ownerUserId, organizationId, tx);
    const expansion = await crmClientSuccessExpansionRepository.create(
      {
        id: generateId(),
        organizationId,
        companyId: input.companyId,
        title: input.title,
        rationale: input.rationale,
        estimatedValueMinorUnits: input.estimatedValueMinorUnits ?? null,
        estimatedValueCurrency: input.estimatedValueCurrency ?? null,
        sourceSignal: input.sourceSignal ?? null,
        notes: input.notes ?? null,
        ownerUserId: input.ownerUserId ?? null,
        createdByUserId: context.user!.id,
      },
      tx,
    );
    return { expansion, companyName: company.name };
  });

  await auditClientSuccess(context, "crm.client_success.expansion_identified", organizationId, "crm_client_success_expansion_opportunity", expansion.id, expansion.title);
  if (input.ownerUserId) {
    await events.emit<{ expansionId: string; organizationId: string; recipientUserId: string; companyName: string; title: string }>("crm.client_success.expansion_owner_assigned", {
      expansionId: expansion.id,
      organizationId,
      recipientUserId: input.ownerUserId,
      companyName,
      title: expansion.title,
    });
  }
  return expansion;
}

const listExpansionsSchema = z.object({ companyId: z.string().uuid() });

export async function listExpansionsForCompany(rawInput: unknown): Promise<CrmClientSuccessExpansionWithRelations[]> {
  const input = parseOrThrow(listExpansionsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.client_success.read");
  return withTenantContext(tenantScope, async (tx) => {
    await getCompanyOrThrow(input.companyId, organizationId, tx);
    return crmClientSuccessExpansionRepository.listForCompany(input.companyId, tx);
  });
}

const updateExpansionSchema = z.object({
  expansionId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  rationale: z.string().trim().min(1).max(2000).optional(),
  estimatedValueMinorUnits: z.number().int().min(0).nullable().optional(),
  estimatedValueCurrency: z.string().length(3).nullable().optional(),
  sourceSignal: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
});

export async function updateExpansionOpportunity(rawInput: unknown): Promise<CrmClientSuccessExpansionOpportunity> {
  const input = parseOrThrow(updateExpansionSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.client_success.manage");
  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmClientSuccessExpansionRepository.findById(input.expansionId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Expansion opportunity");
    if (CLIENT_SUCCESS_EXPANSION_TERMINAL_STATUSES.includes(existing.status)) throw new ValidationError("This expansion opportunity has already reached a terminal state and can no longer be edited.");
    if (input.ownerUserId) await assertPlatformStaffMember(input.ownerUserId, organizationId, tx);
    const updated = await crmClientSuccessExpansionRepository.update(
      input.expansionId,
      { title: input.title, rationale: input.rationale, estimatedValueMinorUnits: input.estimatedValueMinorUnits, estimatedValueCurrency: input.estimatedValueCurrency, sourceSignal: input.sourceSignal, notes: input.notes, ownerUserId: input.ownerUserId },
      tx,
    );
    if (!updated) throw new ConflictError("This expansion opportunity was closed by another request just now.");
    return updated;
  });
}

const qualifyExpansionSchema = z.object({ expansionId: z.string().uuid() });

export async function qualifyExpansionOpportunity(rawInput: unknown): Promise<CrmClientSuccessExpansionOpportunity> {
  const input = parseOrThrow(qualifyExpansionSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.client_success.manage");
  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmClientSuccessExpansionRepository.findById(input.expansionId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Expansion opportunity");
    if (existing.status !== "IDENTIFIED") throw new ValidationError("Only an IDENTIFIED opportunity can be moved to QUALIFIED.");
    const updated = await crmClientSuccessExpansionRepository.setQualified(input.expansionId, tx);
    if (!updated) throw new ConflictError("This expansion opportunity was closed by another request just now.");
    return updated;
  });
}

const handToSalesSchema = z.object({ expansionId: z.string().uuid(), dealId: z.string().uuid().nullable().optional() });

/**
 * The one controlled hand-off — links to an EXISTING deal a staff
 * member explicitly picked, verified to belong to the same company.
 * Never auto-creates a `CrmDeal` (spec's own explicit instruction).
 */
export async function handExpansionToSales(rawInput: unknown): Promise<CrmClientSuccessExpansionOpportunity> {
  const input = parseOrThrow(handToSalesSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.client_success.manage");

  const expansion = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmClientSuccessExpansionRepository.findById(input.expansionId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Expansion opportunity");
    if (input.dealId) {
      const deal = await crmDealRepository.findById(input.dealId, tx);
      if (!deal || deal.organizationId !== organizationId || deal.companyId !== existing.companyId) {
        throw new ValidationError("dealId must reference a deal belonging to this same company.");
      }
    }
    const updated = await crmClientSuccessExpansionRepository.transitionTerminal(input.expansionId, ["IDENTIFIED", "QUALIFIED"], { status: "HANDED_TO_SALES", handedToDealId: input.dealId ?? undefined }, tx);
    if (!updated) throw new ConflictError("This expansion opportunity has already reached a terminal state.");
    return updated;
  });

  await auditClientSuccess(context, "crm.client_success.expansion_handed_to_sales", organizationId, "crm_client_success_expansion_opportunity", expansion.id, expansion.title, { dealId: input.dealId ?? null });
  return expansion;
}

const dismissExpansionSchema = z.object({ expansionId: z.string().uuid() });

export async function dismissExpansionOpportunity(rawInput: unknown): Promise<CrmClientSuccessExpansionOpportunity> {
  const input = parseOrThrow(dismissExpansionSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.client_success.manage");

  const expansion = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmClientSuccessExpansionRepository.findById(input.expansionId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Expansion opportunity");
    const updated = await crmClientSuccessExpansionRepository.transitionTerminal(input.expansionId, ["IDENTIFIED", "QUALIFIED"], { status: "DISMISSED" as CrmClientSuccessExpansionStatus }, tx);
    if (!updated) throw new ConflictError("This expansion opportunity has already reached a terminal state.");
    return updated;
  });

  await auditClientSuccess(context, "crm.client_success.expansion_dismissed", organizationId, "crm_client_success_expansion_opportunity", expansion.id, expansion.title);
  return expansion;
}
