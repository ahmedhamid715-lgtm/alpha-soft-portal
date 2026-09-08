import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext, type TenantContextInput } from "@/lib/tenancy/context";
import { resolveCrmScope, assertPlatformStaffMember, listUsersWithPermission } from "./crm-shared";
import { currencyCodeSchema } from "./crm-deal-service";
import { crmProposalRepository, type CrmProposalListFilters, type CrmProposalWithRelations } from "@/server/repositories/crm-proposal-repository";
import { crmProposalVersionRepository, type CrmProposalVersionWithRelations } from "@/server/repositories/crm-proposal-version-repository";
import { crmProposalLineItemRepository, type CrmProposalLineItemWithoutIds } from "@/server/repositories/crm-proposal-line-item-repository";
import { crmProposalTemplateRepository } from "@/server/repositories/crm-proposal-template-repository";
import { crmDealRepository } from "@/server/repositories/crm-deal-repository";
import { crmContactRepository } from "@/server/repositories/crm-contact-repository";
import { nextProposalNumber } from "@/lib/crm/proposal-numbering";
import { sanitizeProposalHtml } from "@/lib/crm/sanitize-proposal-html";
import { priceProposal, applyTax, type ProposalLineItemInput } from "@/lib/crm/proposal-pricing";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { CrmProposal, CrmProposalVersion, CrmProposalDiscountType } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";
import { db } from "@/lib/db/client";

/**
 * Proposal lifecycle (Build 22 — Roadmap Module 16). Every mutation
 * requires `crm.proposal.manage`; listing/viewing requires
 * `crm.proposal.read`; internal approval DECISIONS additionally require
 * `crm.proposal.approve` (never `.manage` alone — see permissions.ts's
 * own comment). See docs/architecture/proposals-contracts.md for the
 * full design.
 *
 * A proposal ALWAYS originates from an existing `CrmDeal` — there is no
 * standalone-proposal creation path, deliberately, so a proposal can
 * never become a duplicate, disconnected opportunity record. Accepting a
 * proposal never automatically wins its deal; that stays a distinct,
 * explicit staff action (`winDeal()`), same as the master prompt's own
 * "do not automatically mark a deal WON" instruction.
 */

const lineItemInputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  quantity: z.number().int().min(1).default(1),
  unitAmountMinorUnits: z.number().int().min(0),
  discountType: z.enum(["NONE", "FIXED", "PERCENT"]).default("NONE"),
  discountValue: z.number().int().min(0).nullable().optional(),
});

const proposalDiscountSchema = z.object({
  discountType: z.enum(["NONE", "FIXED", "PERCENT"]).default("NONE"),
  discountValue: z.number().int().min(0).nullable().optional(),
});

// Payload shapes mirror `subscribers.ts`'s own local copies exactly —
// same "each side defines its own interface, not a shared import"
// convention `CrmDealAssignedPayload` already establishes in
// `crm-deal-service.ts`.
interface CrmProposalApprovalRequestedPayload {
  proposalId: string;
  organizationId: string;
  proposalNumber: string;
  recipientUserIds: string[];
}
interface CrmProposalApprovalDecidedPayload {
  proposalId: string;
  organizationId: string;
  proposalNumber: string;
  submittedByUserId: string;
  approved: boolean;
}
interface CrmProposalAcceptedPayload {
  proposalId: string;
  organizationId: string;
  proposalNumber: string;
  assignedToUserId: string;
}

function toLineItemInputs(items: z.infer<typeof lineItemInputSchema>[]): ProposalLineItemInput[] {
  return items.map((item) => ({
    quantity: item.quantity,
    unitAmountMinorUnits: item.unitAmountMinorUnits,
    discountType: item.discountType as CrmProposalDiscountType,
    discountValue: item.discountValue ?? null,
  }));
}

function toLineItemRows(priced: ReturnType<typeof priceProposal>["lineItems"], raw: z.infer<typeof lineItemInputSchema>[]): CrmProposalLineItemWithoutIds[] {
  return priced.map((item, index) => ({
    title: raw[index].title,
    description: raw[index].description ?? null,
    quantity: item.quantity,
    unitAmountMinorUnits: item.unitAmountMinorUnits,
    discountType: item.discountType,
    discountValue: item.discountValue,
    lineTotalMinorUnits: item.lineTotalMinorUnits,
    sortOrder: index,
  }));
}

async function auditProposal(
  context: AuthorizationContext,
  action:
    | "crm.proposal.created"
    | "crm.proposal.sent"
    | "crm.proposal.revised"
    | "crm.proposal.approval_submitted"
    | "crm.proposal.approved"
    | "crm.proposal.approval_rejected"
    | "crm.proposal.accepted"
    | "crm.proposal.rejected"
    | "crm.proposal.expired",
  organizationId: string,
  proposalId: string,
  resourceName: string,
): Promise<void> {
  await audit
    .recordSuccess({ action, organizationId, resourceType: "crm_proposal", resourceId: proposalId, resourceName, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error(`[audit] failed to record ${action}`, error));
}

/** Resolves and validates the DRAFT commercial content (title/body/terms/currency/lineItems/discount/tax/validUntil) into what gets persisted on a `CrmProposalVersion` — shared by `createProposal()` and `updateProposalDraft()`. */
function resolveVersionContent(input: {
  title: string;
  bodyHtml: string;
  termsHtml?: string | null;
  currency: string;
  validUntil: Date;
  taxAmountMinorUnits?: number | null;
  lineItems: z.infer<typeof lineItemInputSchema>[];
  discount: z.infer<typeof proposalDiscountSchema>;
}) {
  const priced = priceProposal(toLineItemInputs(input.lineItems), { discountType: input.discount.discountType as CrmProposalDiscountType, discountValue: input.discount.discountValue ?? null });
  const totalMinorUnits = applyTax(priced.totals.discountedSubtotalMinorUnits, input.taxAmountMinorUnits ?? null);
  return {
    versionData: {
      title: input.title,
      bodyHtml: sanitizeProposalHtml(input.bodyHtml),
      termsHtml: input.termsHtml ? sanitizeProposalHtml(input.termsHtml) : null,
      currency: input.currency.toUpperCase(),
      subtotalMinorUnits: priced.totals.subtotalMinorUnits,
      discountType: input.discount.discountType as CrmProposalDiscountType,
      discountValue: input.discount.discountValue ?? null,
      discountedSubtotalMinorUnits: priced.totals.discountedSubtotalMinorUnits,
      taxAmountMinorUnits: input.taxAmountMinorUnits ?? null,
      totalMinorUnits,
      validUntil: input.validUntil,
    },
    lineItemRows: toLineItemRows(priced.lineItems, input.lineItems),
  };
}

const createProposalSchema = z.object({
  dealId: z.string().uuid(),
  primaryContactId: z.string().uuid().nullable().optional(),
  templateId: z.string().uuid().nullable().optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200),
  bodyHtml: z.string().max(200_000),
  termsHtml: z.string().max(200_000).nullable().optional(),
  currency: currencyCodeSchema,
  validUntil: z.coerce.date(),
  taxAmountMinorUnits: z.number().int().min(0).nullable().optional(),
  lineItems: z.array(lineItemInputSchema).min(1).max(100),
  discount: proposalDiscountSchema.default({ discountType: "NONE" }),
});

export async function createProposal(rawInput: unknown): Promise<CrmProposal> {
  const input = parseOrThrow(createProposalSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.proposal.manage");

  const proposal = await withTenantContext(tenantScope, async (tx) => {
    const deal = await crmDealRepository.findById(input.dealId, tx);
    if (!deal || deal.organizationId !== organizationId) throw new NotFoundError("Deal");

    if (input.primaryContactId) {
      const contact = await crmContactRepository.findById(input.primaryContactId, tx);
      if (!contact || contact.organizationId !== organizationId || contact.companyId !== deal.companyId) {
        throw new ValidationError("primaryContactId must reference a contact belonging to this deal's company.");
      }
    }
    if (input.templateId) {
      const template = await crmProposalTemplateRepository.findById(input.templateId, tx);
      if (!template || template.organizationId !== organizationId) throw new ValidationError("templateId does not reference a valid template.");
    }
    if (input.assignedToUserId) await assertPlatformStaffMember(input.assignedToUserId, organizationId, tx);

    const { versionData, lineItemRows } = resolveVersionContent(input);
    const proposalId = generateId();
    const versionId = generateId();
    const proposalNumber = await nextProposalNumber(tx);

    await crmProposalRepository.create(
      { id: proposalId, organizationId, dealId: input.dealId, companyId: deal.companyId, primaryContactId: input.primaryContactId ?? null, proposalNumber, templateId: input.templateId ?? null, assignedToUserId: input.assignedToUserId ?? null },
      tx,
    );
    await crmProposalVersionRepository.create({ id: versionId, organizationId, proposalId, versionNumber: 1, ...versionData, createdByUserId: context.user!.id }, tx);
    await crmProposalLineItemRepository.replaceForVersion(versionId, organizationId, lineItemRows, tx);
    const updated = await crmProposalRepository.setCurrentVersion(proposalId, versionId, tx);
    return updated;
  });

  await auditProposal(context, "crm.proposal.created", organizationId, proposal.id, proposal.proposalNumber);
  return proposal;
}

const listProposalsSchema = z.object({
  dealId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"]).optional(),
  assignedToUserId: z.string().uuid().optional(),
});

export async function listProposals(rawInput: unknown): Promise<CrmProposalWithRelations[]> {
  const input = parseOrThrow(listProposalsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.proposal.read");
  const filters: CrmProposalListFilters = { dealId: input.dealId, companyId: input.companyId, status: input.status, assignedToUserId: input.assignedToUserId };
  return withTenantContext(tenantScope, (tx) => crmProposalRepository.listForOrganization(organizationId, filters, tx));
}

const getProposalSchema = z.object({ proposalId: z.string().uuid() });

export async function getProposalWithRelations(rawInput: unknown): Promise<CrmProposalWithRelations> {
  const input = parseOrThrow(getProposalSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.proposal.read");
  const proposal = await withTenantContext(tenantScope, (tx) => crmProposalRepository.findByIdWithRelations(input.proposalId, tx));
  if (!proposal || proposal.organizationId !== organizationId) throw new NotFoundError("Proposal");
  return proposal;
}

export interface ProposalDetail {
  proposal: CrmProposalWithRelations;
  currentVersion: (CrmProposalVersionWithRelations & { lineItems: Awaited<ReturnType<typeof crmProposalLineItemRepository.listForVersion>> }) | null;
}

/** The full detail view — proposal root + its current version (with line items) resolved together in one call, the shape the proposal detail UI actually needs. */
export async function getProposalDetail(rawInput: unknown): Promise<ProposalDetail> {
  const input = parseOrThrow(getProposalSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.proposal.read");

  return withTenantContext(tenantScope, async (tx) => {
    const proposal = await crmProposalRepository.findByIdWithRelations(input.proposalId, tx);
    if (!proposal || proposal.organizationId !== organizationId) throw new NotFoundError("Proposal");
    if (!proposal.currentVersionId) return { proposal, currentVersion: null };
    // Line items only need `currentVersionId` (already known), not the
    // resolved `version` row itself — parallelized rather than awaited
    // sequentially after the version fetch. Flagged by the Build 22
    // performance review.
    const [version, lineItems] = await Promise.all([
      crmProposalVersionRepository.findByIdWithRelations(proposal.currentVersionId, tx),
      crmProposalLineItemRepository.listForVersion(proposal.currentVersionId, tx),
    ]);
    if (!version) return { proposal, currentVersion: null };
    return { proposal, currentVersion: { ...version, lineItems } };
  });
}

const listVersionsSchema = z.object({ proposalId: z.string().uuid() });

export async function listProposalVersions(rawInput: unknown): Promise<CrmProposalVersionWithRelations[]> {
  const input = parseOrThrow(listVersionsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.proposal.read");
  return withTenantContext(tenantScope, async (tx) => {
    const proposal = await crmProposalRepository.findById(input.proposalId, tx);
    if (!proposal || proposal.organizationId !== organizationId) throw new NotFoundError("Proposal");
    return crmProposalVersionRepository.listForProposal(input.proposalId, tx);
  });
}

/** Loads a proposal + asserts it belongs to this org, and that its CURRENT version matches the one the caller expects to still be DRAFT — the one shared guard `updateProposalDraft()`/`sendProposal()`/`submitProposalForApproval()` all need. */
async function loadDraftableProposal(proposalId: string, organizationId: string, tx: TransactionClient | typeof db): Promise<{ proposal: CrmProposal; version: CrmProposalVersion }> {
  const proposal = await crmProposalRepository.findById(proposalId, tx);
  if (!proposal || proposal.organizationId !== organizationId) throw new NotFoundError("Proposal");
  if (!proposal.currentVersionId) throw new ValidationError("This proposal has no current version.");
  const version = await crmProposalVersionRepository.findById(proposal.currentVersionId, tx);
  if (!version) throw new ValidationError("This proposal's current version could not be found.");
  if (version.status !== "DRAFT") throw new ValidationError("This proposal's current version is no longer editable — use reviseProposal() to start a new version.");
  return { proposal, version };
}

const updateProposalDraftSchema = createProposalSchema
  .omit({ dealId: true, primaryContactId: true, templateId: true, assignedToUserId: true })
  .extend({ proposalId: z.string().uuid() });

/** Edits the CURRENT version's commercial content — ONLY valid while it is still DRAFT (`loadDraftableProposal()`'s own guard; the database trigger is the real backstop against a race). */
export async function updateProposalDraft(rawInput: unknown): Promise<CrmProposalVersion> {
  const input = parseOrThrow(updateProposalDraftSchema, rawInput);
  // No audit event for a plain draft edit — see the master prompt's own
  // audit list (created/sent/revised/... never "draft updated"); an
  // in-progress DRAFT is not yet a meaningful business event.
  const { tenantScope, organizationId } = await resolveCrmScope("crm.proposal.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const { version } = await loadDraftableProposal(input.proposalId, organizationId, tx);
    const { versionData, lineItemRows } = resolveVersionContent(input);
    const saved = await crmProposalVersionRepository.updateDraftContent(version.id, versionData, tx);
    await crmProposalLineItemRepository.replaceForVersion(version.id, organizationId, lineItemRows, tx);
    return saved;
  });
}

const reviseProposalSchema = createProposalSchema.omit({ dealId: true, primaryContactId: true, templateId: true, assignedToUserId: true }).extend({ proposalId: z.string().uuid() });

/** Starts a NEW version (`versionNumber + 1`) from a proposal whose current version has left DRAFT (SENT/REJECTED/EXPIRED) — never edits the old row. Moves the root back to DRAFT and advances `currentVersionId`. An ACCEPTED proposal can never be revised — the accepted commercial terms are permanent legal/business evidence. */
export async function reviseProposal(rawInput: unknown): Promise<CrmProposalVersion> {
  const input = parseOrThrow(reviseProposalSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.proposal.manage");

  const { proposal, newVersion } = await withTenantContext(tenantScope, async (tx) => {
    const proposal = await crmProposalRepository.findById(input.proposalId, tx);
    if (!proposal || proposal.organizationId !== organizationId) throw new NotFoundError("Proposal");
    if (proposal.status === "ACCEPTED") throw new ValidationError("An accepted proposal cannot be revised — its accepted terms are permanent.");
    if (!proposal.currentVersionId) throw new ValidationError("This proposal has no current version.");
    const current = await crmProposalVersionRepository.findById(proposal.currentVersionId, tx);
    if (!current) throw new ValidationError("This proposal's current version could not be found.");
    if (current.status === "DRAFT") throw new ValidationError("This proposal's current version is already DRAFT and editable — use updateProposalDraft() instead.");

    const { versionData, lineItemRows } = resolveVersionContent(input);
    const versionId = generateId();
    const newVersion = await crmProposalVersionRepository.create({ id: versionId, organizationId, proposalId: input.proposalId, versionNumber: current.versionNumber + 1, ...versionData, createdByUserId: context.user!.id }, tx);
    await crmProposalLineItemRepository.replaceForVersion(versionId, organizationId, lineItemRows, tx);
    // CAS on the root's own status as it was just read above — closes a
    // real race a concurrent acceptProposal()/rejectProposal()/expireProposal()
    // could otherwise win in between this read and this write (see
    // reviseToNewVersion()'s own comment).
    const updatedProposal = await crmProposalRepository.reviseToNewVersion(input.proposalId, proposal.status, versionId, tx);
    if (!updatedProposal) throw new ConflictError("This proposal was just changed by someone else. Reload and try again.");
    return { proposal: updatedProposal, newVersion };
  });

  await auditProposal(context, "crm.proposal.revised", organizationId, proposal.id, proposal.proposalNumber);
  return newVersion;
}

const sendProposalSchema = z.object({ proposalId: z.string().uuid() });

export async function sendProposal(rawInput: unknown): Promise<CrmProposal> {
  const input = parseOrThrow(sendProposalSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.proposal.manage");

  const proposal = await withTenantContext(tenantScope, async (tx) => {
    const { version } = await loadDraftableProposal(input.proposalId, organizationId, tx);
    if (version.approvalStatus === "PENDING") throw new ValidationError("This proposal is awaiting internal approval and cannot be sent yet.");
    if (version.approvalStatus === "REJECTED") throw new ValidationError("This proposal's approval was rejected — revise it before sending.");

    const updatedVersion = await crmProposalVersionRepository.markSent(version.id, context.user!.id, tx);
    if (!updatedVersion) throw new ConflictError("This proposal was just changed by someone else. Reload and try again.");
    const updatedProposal = await crmProposalRepository.setStatus(input.proposalId, "SENT", tx);
    return updatedProposal;
  });

  await auditProposal(context, "crm.proposal.sent", organizationId, proposal.id, proposal.proposalNumber);
  return proposal;
}

const submitForApprovalSchema = z.object({ proposalId: z.string().uuid() });

export async function submitProposalForApproval(rawInput: unknown): Promise<CrmProposalVersion> {
  const input = parseOrThrow(submitForApprovalSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.proposal.manage");

  const { proposal, updatedVersion } = await withTenantContext(tenantScope, async (tx) => {
    const { proposal, version } = await loadDraftableProposal(input.proposalId, organizationId, tx);
    const updatedVersion = await crmProposalVersionRepository.submitForApproval(version.id, context.user!.id, tx);
    if (!updatedVersion) throw new ConflictError("An approval request was already submitted for this version.");
    return { proposal, updatedVersion };
  });

  await auditProposal(context, "crm.proposal.approval_submitted", organizationId, proposal.id, proposal.proposalNumber);
  const approvers = await listUsersWithPermission("crm.proposal.approve", organizationId);
  const recipientUserIds = approvers.map((u) => u.id).filter((id) => id !== context.user!.id);
  if (recipientUserIds.length > 0) {
    await events.emit<CrmProposalApprovalRequestedPayload>("crm.proposal.approval_requested", { proposalId: proposal.id, organizationId, proposalNumber: proposal.proposalNumber, recipientUserIds });
  }
  return updatedVersion;
}

const decideApprovalSchema = z.object({ proposalId: z.string().uuid(), approved: z.boolean(), note: z.string().max(2000).nullable().optional() });

/**
 * The self-approval prohibition is enforced HERE, server-side, against
 * the version's own recorded `approvalSubmittedByUserId` — never merely
 * by UI omission. `crm.proposal.approve` is a separately grantable
 * permission from `.manage` specifically so this check has teeth (see
 * permissions.ts's own comment).
 */
export async function decideProposalApproval(rawInput: unknown): Promise<CrmProposalVersion> {
  const input = parseOrThrow(decideApprovalSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.proposal.approve");

  const { proposal, submittedByUserId, updatedVersion } = await withTenantContext(tenantScope, async (tx) => {
    const proposal = await crmProposalRepository.findById(input.proposalId, tx);
    if (!proposal || proposal.organizationId !== organizationId) throw new NotFoundError("Proposal");
    if (!proposal.currentVersionId) throw new ValidationError("This proposal has no current version.");
    const version = await crmProposalVersionRepository.findById(proposal.currentVersionId, tx);
    if (!version) throw new ValidationError("This proposal's current version could not be found.");
    if (version.approvalStatus !== "PENDING") throw new ValidationError("This proposal version is not awaiting approval.");
    if (version.approvalSubmittedByUserId === context.user!.id) {
      throw new ValidationError("You cannot approve or reject a proposal you submitted for approval yourself.");
    }

    const updatedVersion = await crmProposalVersionRepository.decideApproval(version.id, input.approved, context.user!.id, input.note ?? null, tx);
    if (!updatedVersion) throw new ConflictError("This approval request was already decided by someone else.");
    return { proposal, submittedByUserId: version.approvalSubmittedByUserId, updatedVersion };
  });

  await auditProposal(context, input.approved ? "crm.proposal.approved" : "crm.proposal.approval_rejected", organizationId, proposal.id, proposal.proposalNumber);
  if (submittedByUserId) {
    await events.emit<CrmProposalApprovalDecidedPayload>("crm.proposal.approval_decided", { proposalId: proposal.id, organizationId, proposalNumber: proposal.proposalNumber, submittedByUserId, approved: input.approved });
  }
  return updatedVersion;
}

/**
 * Lazily transitions a SENT proposal whose current version's `validUntil`
 * has already passed into EXPIRED — run in its OWN transaction, which
 * COMMITS before the caller's own main action transaction even opens.
 *
 * This is deliberately NOT run inside `acceptProposal()`/`rejectProposal()`'s
 * own transaction, and does not throw. An earlier version of this
 * function did both — it ran as a side effect inside the same
 * transaction as the accept/reject attempt, and then that same
 * transaction threw a `ValidationError` immediately afterward to refuse
 * the accept/reject. Since a thrown error inside `withTenantContext()`'s
 * callback aborts and rolls back the ENTIRE transaction (see
 * `withTransaction()`'s own top comment), the expiry write itself was
 * silently rolled back too — the error message claimed the proposal was
 * "now marked EXPIRED" while the database still showed it as SENT. Found
 * by Codex's own Build 22 security review. The fix is to make the expiry
 * transition its own, independently-committed step: callers run this
 * first, then open their own transaction and re-read the proposal's
 * (now possibly EXPIRED) status from scratch — the ordinary "only a SENT
 * proposal can be accepted/rejected" check downstream naturally reflects
 * whatever actually got persisted.
 */
async function expireIfPastValidity(proposalId: string, organizationId: string, tenantScope: TenantContextInput): Promise<void> {
  await withTenantContext(tenantScope, async (tx) => {
    const proposal = await crmProposalRepository.findById(proposalId, tx);
    if (!proposal || proposal.organizationId !== organizationId || proposal.status !== "SENT" || !proposal.currentVersionId) return;
    const version = await crmProposalVersionRepository.findById(proposal.currentVersionId, tx);
    if (!version || version.status !== "SENT" || version.validUntil.getTime() > Date.now()) return;
    const updatedVersion = await crmProposalVersionRepository.markExpired(version.id, tx);
    if (updatedVersion) await crmProposalRepository.transitionTerminal(proposalId, "SENT", { status: "EXPIRED", expiredAt: new Date() }, tx);
  });
}

const proposalIdSchema = z.object({ proposalId: z.string().uuid() });

export async function expireProposal(rawInput: unknown): Promise<CrmProposal> {
  const input = parseOrThrow(proposalIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.proposal.manage");

  const proposal = await withTenantContext(tenantScope, async (tx) => {
    const proposal = await crmProposalRepository.findById(input.proposalId, tx);
    if (!proposal || proposal.organizationId !== organizationId) throw new NotFoundError("Proposal");
    if (proposal.status !== "SENT") throw new ValidationError("Only a SENT proposal can be marked expired.");
    if (!proposal.currentVersionId) throw new ValidationError("This proposal has no current version.");
    const version = await crmProposalVersionRepository.findById(proposal.currentVersionId, tx);
    if (!version) throw new ValidationError("This proposal's current version could not be found.");

    const updatedVersion = await crmProposalVersionRepository.markExpired(version.id, tx);
    if (!updatedVersion) throw new ConflictError("This proposal was just changed by someone else. Reload and try again.");
    const updatedProposal = await crmProposalRepository.transitionTerminal(input.proposalId, "SENT", { status: "EXPIRED", expiredAt: new Date() }, tx);
    if (!updatedProposal) throw new ConflictError("This proposal was just changed by someone else. Reload and try again.");
    return updatedProposal;
  });

  await auditProposal(context, "crm.proposal.expired", organizationId, proposal.id, proposal.proposalNumber);
  return proposal;
}

const rejectProposalSchema = z.object({ proposalId: z.string().uuid(), reason: z.string().min(1).max(1000) });

export async function rejectProposal(rawInput: unknown): Promise<CrmProposal> {
  const input = parseOrThrow(rejectProposalSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.proposal.manage");
  // Runs and COMMITS in its own transaction before the main attempt below
  // even opens — see `expireIfPastValidity()`'s own comment for why this
  // can't safely run inside the same transaction it's guarding.
  await expireIfPastValidity(input.proposalId, organizationId, tenantScope);

  const proposal = await withTenantContext(tenantScope, async (tx) => {
    const proposal = await crmProposalRepository.findById(input.proposalId, tx);
    if (!proposal || proposal.organizationId !== organizationId) throw new NotFoundError("Proposal");
    if (!proposal.currentVersionId) throw new ValidationError("This proposal has no current version.");
    const version = await crmProposalVersionRepository.findById(proposal.currentVersionId, tx);
    if (!version) throw new ValidationError("This proposal's current version could not be found.");
    if (proposal.status === "EXPIRED") throw new ValidationError("This proposal has expired and can no longer be rejected.");
    if (proposal.status !== "SENT") throw new ValidationError("Only a SENT proposal can be rejected.");

    const updatedVersion = await crmProposalVersionRepository.markRejected(version.id, input.reason, tx);
    if (!updatedVersion) throw new ConflictError("This proposal was just changed by someone else. Reload and try again.");
    const updatedProposal = await crmProposalRepository.transitionTerminal(input.proposalId, "SENT", { status: "REJECTED", rejectedAt: new Date() }, tx);
    if (!updatedProposal) throw new ConflictError("This proposal was just changed by someone else. Reload and try again.");
    return updatedProposal;
  });

  await auditProposal(context, "crm.proposal.rejected", organizationId, proposal.id, proposal.proposalNumber);
  return proposal;
}

const acceptProposalSchema = z.object({
  proposalId: z.string().uuid(),
  acceptedByContactId: z.string().uuid().nullable().optional(),
  acceptedSignerName: z.string().min(1).max(200),
  acceptedSignerEmail: z.string().email().max(320),
});

/**
 * Records a REAL acceptance a staff member obtained outside Alpha OS
 * (verbal/email/in-person) — `acceptanceMechanism` is always
 * `INTERNAL_RECORDED` (see proposals-contracts.md "E-signature
 * readiness"; there is no self-service external acceptance surface in
 * Build 22). Structurally protected against every race the master
 * prompt lists: the CAS on `status = 'SENT'` (both root and version)
 * rejects double-acceptance and a superseded/already-decided proposal in
 * one guard; there is no way to target an old version — this always
 * operates on the proposal's own CURRENT version id, resolved server-
 * side, never accepted from client input; a cross-tenant proposal 404s
 * before any of this even runs (`resolveCrmScope` + explicit org check).
 */
export async function acceptProposal(rawInput: unknown): Promise<CrmProposal> {
  const input = parseOrThrow(acceptProposalSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.proposal.manage");
  // Runs and COMMITS in its own transaction before the main attempt below
  // even opens — see `expireIfPastValidity()`'s own comment for why this
  // can't safely run inside the same transaction it's guarding.
  await expireIfPastValidity(input.proposalId, organizationId, tenantScope);

  const proposal = await withTenantContext(tenantScope, async (tx) => {
    const proposal = await crmProposalRepository.findById(input.proposalId, tx);
    if (!proposal || proposal.organizationId !== organizationId) throw new NotFoundError("Proposal");
    if (!proposal.currentVersionId) throw new ValidationError("This proposal has no current version.");
    const version = await crmProposalVersionRepository.findById(proposal.currentVersionId, tx);
    if (!version) throw new ValidationError("This proposal's current version could not be found.");
    if (proposal.status === "EXPIRED") throw new ValidationError("This proposal has expired and can no longer be accepted.");
    if (proposal.status !== "SENT") throw new ValidationError("Only a SENT proposal can be accepted.");

    if (input.acceptedByContactId) {
      const contact = await crmContactRepository.findById(input.acceptedByContactId, tx);
      if (!contact || contact.organizationId !== organizationId || contact.companyId !== proposal.companyId) {
        throw new ValidationError("acceptedByContactId must reference a contact belonging to this proposal's company.");
      }
    }

    const updatedVersion = await crmProposalVersionRepository.markAccepted(
      version.id,
      { acceptedByContactId: input.acceptedByContactId ?? null, acceptedSignerName: input.acceptedSignerName, acceptedSignerEmail: input.acceptedSignerEmail, acceptedByStaffUserId: context.user!.id, acceptanceMechanism: "INTERNAL_RECORDED" },
      tx,
    );
    if (!updatedVersion) throw new ConflictError("This proposal was just changed by someone else. Reload and try again.");
    const updatedProposal = await crmProposalRepository.transitionTerminal(input.proposalId, "SENT", { status: "ACCEPTED", acceptedAt: new Date() }, tx);
    if (!updatedProposal) throw new ConflictError("This proposal was just changed by someone else. Reload and try again.");
    return updatedProposal;
  });

  await auditProposal(context, "crm.proposal.accepted", organizationId, proposal.id, proposal.proposalNumber);
  if (proposal.assignedToUserId) {
    await events.emit<CrmProposalAcceptedPayload>("crm.proposal.accepted", { proposalId: proposal.id, organizationId, proposalNumber: proposal.proposalNumber, assignedToUserId: proposal.assignedToUserId });
  }
  return proposal;
}

const assignProposalSchema = z.object({ proposalId: z.string().uuid(), assignedToUserId: z.string().uuid().nullable() });

export async function assignProposal(rawInput: unknown): Promise<CrmProposal> {
  const input = parseOrThrow(assignProposalSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.proposal.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const proposal = await crmProposalRepository.findById(input.proposalId, tx);
    if (!proposal || proposal.organizationId !== organizationId) throw new NotFoundError("Proposal");
    if (input.assignedToUserId) await assertPlatformStaffMember(input.assignedToUserId, organizationId, tx);
    return crmProposalRepository.setAssignee(input.proposalId, input.assignedToUserId, tx);
  });
}
