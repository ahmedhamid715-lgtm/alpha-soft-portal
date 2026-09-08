import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope } from "./crm-shared";
import { crmContractRepository, type CrmContractListFilters, type CrmContractWithRelations } from "@/server/repositories/crm-contract-repository";
import { crmProposalRepository } from "@/server/repositories/crm-proposal-repository";
import { crmDealRepository } from "@/server/repositories/crm-deal-repository";
import { nextContractNumber } from "@/lib/crm/contract-numbering";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { CrmContract } from "@/generated/prisma/client";

/**
 * Contract lifecycle (Build 22 — Roadmap Module 16) — `crm.contract.manage`
 * for mutations, `crm.contract.read` for listing/viewing. A contract
 * represents the commercial agreement itself: either originated from an
 * ACCEPTED proposal version (the common path — `createContractFromProposal()`),
 * or a manually recorded agreement where justified (`createManualContract()`).
 * Never a document store — see the model's own schema comment.
 *
 * Lifecycle: DRAFT -> ACTIVE -> (TERMINATED | EXPIRED); DRAFT -> CANCELLED.
 * Every transition is a real compare-and-swap at the repository layer,
 * same discipline as `crmDealRepository`'s own win/lose/reopen.
 */

/** Cheap, real correctness check flagged by Codex's own Build 22 security review — neither the CHECK constraints nor the relationship-integrity trigger enforce `endDate >= effectiveDate`, so it must be validated here. Both null, or only one supplied, is fine (an open-ended or not-yet-scheduled contract). */
function assertValidDateRange(effectiveDate: Date | null, endDate: Date | null): void {
  if (effectiveDate && endDate && endDate.getTime() < effectiveDate.getTime()) {
    throw new ValidationError("endDate cannot be before effectiveDate.");
  }
}

async function auditContract(
  context: AuthorizationContext,
  action: "crm.contract.created" | "crm.contract.activated" | "crm.contract.terminated" | "crm.contract.cancelled",
  organizationId: string,
  contractId: string,
  resourceName: string,
): Promise<void> {
  await audit
    .recordSuccess({ action, organizationId, resourceType: "crm_contract", resourceId: contractId, resourceName, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error(`[audit] failed to record ${action}`, error));
}

const createFromProposalSchema = z.object({
  proposalId: z.string().uuid(),
  effectiveDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  renewalTerms: z.string().max(2000).nullable().optional(),
});

/**
 * The common path: a contract originated from a proposal's own ACCEPTED
 * version. `originatingProposalVersionId` is always the proposal's
 * CURRENT version at the moment of acceptance — an ACCEPTED proposal can
 * never be revised (see `reviseProposal()`'s own guard), so there is no
 * "which version" ambiguity to resolve here. Does not copy the
 * proposal's own content onto the contract — the immutable accepted
 * version IS the legal/commercial snapshot; the contract references it
 * rather than duplicating it (master prompt's own explicit instruction).
 */
export async function createContractFromProposal(rawInput: unknown): Promise<CrmContract> {
  const input = parseOrThrow(createFromProposalSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.contract.manage");
  assertValidDateRange(input.effectiveDate ?? null, input.endDate ?? null);

  const contract = await withTenantContext(tenantScope, async (tx) => {
    const proposal = await crmProposalRepository.findById(input.proposalId, tx);
    if (!proposal || proposal.organizationId !== organizationId) throw new NotFoundError("Proposal");
    if (proposal.status !== "ACCEPTED" || !proposal.currentVersionId) {
      throw new ValidationError("A contract can only be created from an ACCEPTED proposal.");
    }

    const contractId = generateId();
    const contractNumber = await nextContractNumber(tx);
    return crmContractRepository.create(
      {
        id: contractId,
        organizationId,
        dealId: proposal.dealId,
        companyId: proposal.companyId,
        originatingProposalId: proposal.id,
        originatingProposalVersionId: proposal.currentVersionId,
        contractNumber,
        effectiveDate: input.effectiveDate ?? null,
        endDate: input.endDate ?? null,
        renewalTerms: input.renewalTerms ?? null,
        createdByUserId: context.user!.id,
      },
      tx,
    );
  });

  await auditContract(context, "crm.contract.created", organizationId, contract.id, contract.contractNumber);
  return contract;
}

const createManualSchema = z.object({
  dealId: z.string().uuid(),
  effectiveDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  renewalTerms: z.string().max(2000).nullable().optional(),
});

/** The manual path — a real agreement reached outside a Build 22 proposal (e.g. negotiated directly, or predates this module). No originating proposal reference; the relationship-integrity trigger's own origin-pair-consistency check requires both proposal fields stay null together here. */
export async function createManualContract(rawInput: unknown): Promise<CrmContract> {
  const input = parseOrThrow(createManualSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.contract.manage");
  assertValidDateRange(input.effectiveDate ?? null, input.endDate ?? null);

  const contract = await withTenantContext(tenantScope, async (tx) => {
    const deal = await crmDealRepository.findById(input.dealId, tx);
    if (!deal || deal.organizationId !== organizationId) throw new NotFoundError("Deal");

    const contractId = generateId();
    const contractNumber = await nextContractNumber(tx);
    return crmContractRepository.create(
      {
        id: contractId,
        organizationId,
        dealId: deal.id,
        companyId: deal.companyId,
        originatingProposalId: null,
        originatingProposalVersionId: null,
        contractNumber,
        effectiveDate: input.effectiveDate ?? null,
        endDate: input.endDate ?? null,
        renewalTerms: input.renewalTerms ?? null,
        createdByUserId: context.user!.id,
      },
      tx,
    );
  });

  await auditContract(context, "crm.contract.created", organizationId, contract.id, contract.contractNumber);
  return contract;
}

const listContractsSchema = z.object({
  dealId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED", "CANCELLED"]).optional(),
});

export async function listContracts(rawInput: unknown): Promise<CrmContractWithRelations[]> {
  const input = parseOrThrow(listContractsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.contract.read");
  const filters: CrmContractListFilters = { dealId: input.dealId, companyId: input.companyId, status: input.status };
  return withTenantContext(tenantScope, (tx) => crmContractRepository.listForOrganization(organizationId, filters, tx));
}

const getContractSchema = z.object({ contractId: z.string().uuid() });

export async function getContractWithRelations(rawInput: unknown): Promise<CrmContractWithRelations> {
  const input = parseOrThrow(getContractSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.contract.read");
  const contract = await withTenantContext(tenantScope, (tx) => crmContractRepository.findByIdWithRelations(input.contractId, tx));
  if (!contract || contract.organizationId !== organizationId) throw new NotFoundError("Contract");
  return contract;
}

const activateContractSchema = z.object({ contractId: z.string().uuid(), effectiveDate: z.coerce.date().optional() });

export async function activateContract(rawInput: unknown): Promise<CrmContract> {
  const input = parseOrThrow(activateContractSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.contract.manage");

  const contract = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmContractRepository.findById(input.contractId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Contract");
    const effectiveDate = input.effectiveDate ?? existing.effectiveDate ?? new Date();
    assertValidDateRange(effectiveDate, existing.endDate);
    const updated = await crmContractRepository.activate(input.contractId, effectiveDate, tx);
    if (!updated) throw new ConflictError("This contract was just changed by someone else. Reload and try again.");
    return updated;
  });

  await auditContract(context, "crm.contract.activated", organizationId, contract.id, contract.contractNumber);
  return contract;
}

const terminateContractSchema = z.object({ contractId: z.string().uuid(), reason: z.string().min(1).max(1000) });

export async function terminateContract(rawInput: unknown): Promise<CrmContract> {
  const input = parseOrThrow(terminateContractSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.contract.manage");

  const contract = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmContractRepository.findById(input.contractId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Contract");
    const updated = await crmContractRepository.terminate(input.contractId, input.reason, tx);
    if (!updated) throw new ConflictError("This contract was just changed by someone else. Reload and try again.");
    return updated;
  });

  await auditContract(context, "crm.contract.terminated", organizationId, contract.id, contract.contractNumber);
  return contract;
}

const cancelContractSchema = z.object({ contractId: z.string().uuid() });

export async function cancelContract(rawInput: unknown): Promise<CrmContract> {
  const input = parseOrThrow(cancelContractSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.contract.manage");

  const contract = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmContractRepository.findById(input.contractId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Contract");
    const updated = await crmContractRepository.cancel(input.contractId, tx);
    if (!updated) throw new ConflictError("This contract was just changed by someone else. Reload and try again.");
    return updated;
  });

  await auditContract(context, "crm.contract.cancelled", organizationId, contract.id, contract.contractNumber);
  return contract;
}

const expireContractSchema = z.object({ contractId: z.string().uuid() });

/** Explicit staff action only — Build 22 has no background job infrastructure to drive this automatically off `endDate` (see docs/architecture/proposals-contracts.md "Known limitations"). */
export async function expireContract(rawInput: unknown): Promise<CrmContract> {
  const input = parseOrThrow(expireContractSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.contract.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmContractRepository.findById(input.contractId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Contract");
    const updated = await crmContractRepository.expire(input.contractId, tx);
    if (!updated) throw new ConflictError("This contract was just changed by someone else. Reload and try again.");
    return updated;
  });
}
