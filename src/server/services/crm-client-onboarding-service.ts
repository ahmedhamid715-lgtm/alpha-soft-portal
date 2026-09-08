import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope, assertPlatformStaffMember, listUsersWithPermission } from "./crm-shared";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { crmDealRepository } from "@/server/repositories/crm-deal-repository";
import { crmContractRepository } from "@/server/repositories/crm-contract-repository";
import { crmProposalRepository } from "@/server/repositories/crm-proposal-repository";
import { crmProposalLineItemRepository } from "@/server/repositories/crm-proposal-line-item-repository";
import { crmClientOnboardingRepository, type CrmClientOnboardingListFilters, type CrmClientOnboardingWithRelations } from "@/server/repositories/crm-client-onboarding-repository";
import { crmClientOnboardingServiceItemRepository } from "@/server/repositories/crm-client-onboarding-service-item-repository";
import { crmClientOnboardingChecklistItemRepository } from "@/server/repositories/crm-client-onboarding-checklist-item-repository";
import { crmClientOnboardingRequirementRepository } from "@/server/repositories/crm-client-onboarding-requirement-repository";
import { crmClientOnboardingDocumentRepository } from "@/server/repositories/crm-client-onboarding-document-repository";
import { crmClientOnboardingIntakeFieldRepository } from "@/server/repositories/crm-client-onboarding-intake-field-repository";
import { crmClientOnboardingIntakeResponseRepository } from "@/server/repositories/crm-client-onboarding-intake-response-repository";
import { crmClientOnboardingAssignmentRepository } from "@/server/repositories/crm-client-onboarding-assignment-repository";
import { evaluateCompletionCriteria, calculateProgress, isReadyForKickoff, type OnboardingProgress, type CompletionCriteriaResult } from "@/lib/crm/onboarding-progress";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { CrmClientOnboarding, CrmClientOnboardingStatus, CrmContract, CrmProposal, Organization } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Client onboarding lifecycle (Build 23 — Roadmap Module 17). Every
 * mutation requires `crm.onboarding.manage`; listing/viewing requires
 * `crm.onboarding.read`; forcing completion despite incomplete required
 * work additionally requires `crm.onboarding.complete`. See
 * docs/architecture/client-onboarding.md for the full design.
 *
 * The CRM Company -> Organization conversion is the one deliberately
 * narrow, authorized, idempotent chokepoint for that boundary — see
 * `resolveLinkedOrganization()`'s own comment. Nothing else in Build 23
 * (or any other module) creates an Organization as a side effect.
 */

// --- Default checklist template — a genuinely generic starting point,
// not a fabricated business-specific methodology. Deliberately does NOT
// duplicate the intake/kickoff completion gates (those are tracked by
// their own dedicated mechanisms, not as checklist items).
const DEFAULT_CHECKLIST_TEMPLATE: { title: string; description: string | null; required: boolean }[] = [
  { title: "Confirm primary point of contact", description: null, required: true },
  { title: "Internal kickoff briefing", description: "The internal team is aligned on scope, services sold, and delivery plan before the client-facing kickoff.", required: true },
  { title: "Review sold services with client", description: null, required: true },
];

/**
 * Locks the onboarding row (`findByIdLocked` — `SELECT ... FOR UPDATE`)
 * and verifies tenant ownership, WITHOUT any status check. Used by the
 * terminal-transition paths (`cancelOnboarding()`,
 * `forceCompleteOnboarding()`) that must still run their own CAS even
 * against an already-terminal row (so they can report the existing
 * `ConflictError` semantics on a lost race) but that must still hold this
 * same lock so they properly serialize against every concurrent
 * child-record mutation below.
 */
async function lockOnboarding(onboardingId: string, organizationId: string, tx: TransactionClient): Promise<CrmClientOnboarding> {
  const onboarding = await crmClientOnboardingRepository.findByIdLocked(onboardingId, tx);
  if (!onboarding || onboarding.organizationId !== organizationId) throw new NotFoundError("Onboarding");
  return onboarding;
}

/**
 * Locks the onboarding row AND rejects if it has already reached a
 * terminal state (Codex Security Engineer finding #2 — "terminal
 * onboardings remain mutable through most direct actions"). This is the
 * one guard every non-terminal mutation in this domain must call before
 * writing anything — ordinary status changes, kickoff scheduling/
 * completion, and every child-record write (requirements, checklist
 * items, documents, intake responses, assignments) in
 * `crm-client-onboarding-checklist-service.ts` and
 * `crm-client-onboarding-intake-service.ts`. Because it takes the SAME
 * row lock `lockOnboarding()`/`completeOnboarding()` take, a concurrent
 * terminal transition and a concurrent child-record write always
 * serialize against each other rather than interleave — this is also
 * what closes finding #1 (a status update resurrecting a just-completed/
 * cancelled onboarding) and finding #3 (completion criteria going stale
 * between being evaluated and written) for the same reason: whichever
 * transaction acquires the lock first runs its entire check-then-write to
 * completion before the other can even read the row.
 */
export async function lockActiveOnboarding(onboardingId: string, organizationId: string, tx: TransactionClient): Promise<CrmClientOnboarding> {
  const onboarding = await lockOnboarding(onboardingId, organizationId, tx);
  if (onboarding.status === "COMPLETED" || onboarding.status === "CANCELLED") {
    throw new ValidationError("This onboarding has already reached a terminal state and can no longer be modified.");
  }
  return onboarding;
}

async function auditOnboarding(
  context: AuthorizationContext,
  action:
    | "crm.onboarding.started"
    | "crm.onboarding.organization_linked"
    | "crm.onboarding.assigned"
    | "crm.onboarding.kickoff_scheduled"
    | "crm.onboarding.kickoff_completed"
    | "crm.onboarding.completed"
    | "crm.onboarding.completed_override"
    | "crm.onboarding.cancelled",
  organizationId: string,
  onboardingId: string,
  resourceName: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await audit
    .recordSuccess({ action, organizationId, resourceType: "crm_client_onboarding", resourceId: onboardingId, resourceName, metadata, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error(`[audit] failed to record ${action}`, error));
}

/** A minimal, URL-safe slug derived from the company name — collision-resolved with a numeric suffix, mirroring `organization-service.ts`'s own `slugSchema` shape (lowercase, hyphenated). Only used for a NEW customer organization's own slug; an already-converted company reuses its existing organization untouched. */
async function generateUniqueOrganizationSlug(companyName: string, tx: TransactionClient): Promise<string> {
  const base = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "client";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await organizationRepository.findBySlug(candidate, tx);
    if (!existing) return candidate;
  }
  // Astronomically unlikely (50 real naming collisions on the same base) — a
  // random, still-legible suffix rather than looping forever.
  return `${base}-${generateId().slice(0, 8)}`;
}

/**
 * Resolves the CRM company's own linked customer `Organization` —
 * reusing it if `convertedToOrganizationId` is already set, otherwise
 * creating a new one and linking it. The idempotency guarantee is a real
 * CAS (`crmCompanyRepository.linkToOrganization()`, guarded on
 * `convertedToOrganizationId IS NULL`), backed by a database UNIQUE
 * constraint as a second, structural layer — not merely a pre-check. A
 * lost race (a concurrent conversion attempt for the SAME company
 * committed first) surfaces as a clean `ConflictError`; Postgres's own
 * row-level locking on the CAS `UPDATE` means the loser's freshly-created
 * Organization row rolls back automatically with the rest of its own
 * transaction — no manual cleanup needed. Never merges/reuses an
 * Organization based on name/email/domain heuristics — only ever via this
 * exact company's own `convertedToOrganizationId`.
 */
async function resolveLinkedOrganization(company: { id: string; name: string; convertedToOrganizationId: string | null }, tx: TransactionClient): Promise<Organization> {
  if (company.convertedToOrganizationId) {
    const existing = await organizationRepository.findById(company.convertedToOrganizationId, tx);
    if (existing) return existing;
  }

  const slug = await generateUniqueOrganizationSlug(company.name, tx);
  const newOrganization = await organizationRepository.create({ id: generateId(), name: company.name, displayName: company.name, slug }, tx);
  const linked = await crmCompanyRepository.linkToOrganization(company.id, newOrganization.id, tx);
  if (!linked) {
    throw new ConflictError("This company was just linked to an organization by another request. Reload and try again.");
  }
  return newOrganization;
}

export interface OnboardingEligibility {
  deal: { id: string; title: string; companyId: string };
  originatingContract: CrmContract | null;
  originatingProposal: CrmProposal | null;
}

/**
 * Eligibility (decision #1/#2/#3): deal must be WON; if the deal has any
 * contract, at least one must be ACTIVE (the contract is the preferred/
 * authoritative trigger when one exists); otherwise the deal must have an
 * ACCEPTED proposal. No existing non-CANCELLED onboarding for this deal.
 * Rejects with a specific `ValidationError`/`ConflictError` — never
 * merely hidden by the UI.
 */
async function resolveEligibility(dealId: string, organizationId: string, tx: TransactionClient): Promise<OnboardingEligibility> {
  const deal = await crmDealRepository.findById(dealId, tx);
  if (!deal || deal.organizationId !== organizationId) throw new NotFoundError("Deal");
  if (deal.status !== "WON") throw new ValidationError("Only a WON deal can start onboarding.");

  const existingActive = await crmClientOnboardingRepository.findActiveForDeal(dealId, tx);
  if (existingActive) throw new ConflictError("This deal already has an active onboarding engagement.");

  const contracts = await crmContractRepository.listForOrganization(organizationId, { dealId }, tx);
  if (contracts.length > 0) {
    const activeContract = contracts.find((c) => c.status === "ACTIVE");
    if (!activeContract) {
      throw new ValidationError("This deal has a contract, but none is ACTIVE — onboarding requires an ACTIVE contract.");
    }
    return { deal: { id: deal.id, title: deal.title, companyId: deal.companyId }, originatingContract: activeContract, originatingProposal: null };
  }

  const proposals = await crmProposalRepository.listForOrganization(organizationId, { dealId }, tx);
  const acceptedProposal = proposals.find((p) => p.status === "ACCEPTED");
  if (!acceptedProposal) {
    throw new ValidationError("This deal has no ACTIVE contract and no ACCEPTED proposal — there is nothing to onboard from.");
  }
  return { deal: { id: deal.id, title: deal.title, companyId: deal.companyId }, originatingContract: null, originatingProposal: acceptedProposal };
}

const checkEligibilitySchema = z.object({ dealId: z.string().uuid() });

/**
 * Read-only eligibility check — for a deal's own detail page to decide
 * whether to render a "Start onboarding" action, without performing any
 * write. Returns `{ eligible: false, reason }` instead of throwing, since
 * an ineligible deal is an entirely ordinary, expected state for this
 * read path (unlike `convertDealToClient()`, where the same condition is
 * a real rejection of an attempted mutation).
 */
export async function checkOnboardingEligibility(rawInput: unknown): Promise<{ eligible: true } | { eligible: false; reason: string }> {
  const input = parseOrThrow(checkEligibilitySchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.read");
  return withTenantContext(tenantScope, async (tx) => {
    try {
      await resolveEligibility(input.dealId, organizationId, tx);
      return { eligible: true };
    } catch (error) {
      if (error instanceof ValidationError || error instanceof ConflictError) return { eligible: false, reason: error.message };
      throw error;
    }
  });
}

const convertDealToClientSchema = z.object({
  dealId: z.string().uuid(),
  assignments: z
    .array(z.object({ role: z.enum(["ACCOUNT_MANAGER", "ONBOARDING_OWNER", "SERVICE_LEAD"]), userId: z.string().uuid() }))
    .max(3)
    .optional(),
});

/**
 * The one authoritative deal-to-client conversion operation (decisions
 * #5/#6/#27): validates eligibility, resolves/creates the linked
 * Organization, creates the `CrmClientOnboarding` root, snapshots sold
 * services from the triggering commercial source, seeds the default
 * checklist, optionally assigns internal staff, and audits/notifies.
 * ONE transaction — commits or none of it does. Never provisions
 * anything beyond this (no projects, no billing, no external services —
 * see this module's own docs "Project Management boundary").
 */
export async function convertDealToClient(rawInput: unknown): Promise<CrmClientOnboarding> {
  const input = parseOrThrow(convertDealToClientSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");

  const { onboarding, linkedOrganization, organizationWasCreated } = await withTenantContext(tenantScope, async (tx) => {
    // Verified inside the same transaction that creates the assignment
    // rows (Codex Security Engineer finding #5) — not beforehand, which
    // would leave a window between the check and the write.
    if (input.assignments) {
      for (const a of input.assignments) await assertPlatformStaffMember(a.userId, organizationId, tx);
    }

    const eligibility = await resolveEligibility(input.dealId, organizationId, tx);
    const company = await crmCompanyRepository.findById(eligibility.deal.companyId, tx);
    if (!company || company.organizationId !== organizationId) throw new NotFoundError("Company");

    const organizationWasCreated = company.convertedToOrganizationId === null;
    const linkedOrganization = await resolveLinkedOrganization(company, tx);

    const onboardingId = generateId();
    const onboarding = await crmClientOnboardingRepository.create(
      {
        id: onboardingId,
        organizationId,
        dealId: eligibility.deal.id,
        companyId: eligibility.deal.companyId,
        linkedOrganizationId: linkedOrganization.id,
        originatingContractId: eligibility.originatingContract?.id ?? null,
        originatingProposalId: eligibility.originatingProposal?.id ?? eligibility.originatingContract?.originatingProposalId ?? null,
        createdByUserId: context.user!.id,
        // Created directly as IN_PROGRESS — not `NOT_STARTED` followed
        // by a separate `setStatus()` call, which was a wasted extra CAS
        // round trip on a row nothing else could see yet (uncommitted in
        // this same transaction) whose own return value was discarded
        // anyway (Codex Performance Engineer review).
        status: "IN_PROGRESS",
      },
      tx,
    );

    // Service snapshot — derived from the triggering commercial source's
    // own accepted line items where one exists (decision #11); a
    // manually-recorded contract with no proposal at all simply yields
    // no service items here (staff can add them via the requirements/
    // checklist surface — see client-onboarding.md).
    const originatingVersionId = eligibility.originatingContract?.originatingProposalVersionId ?? eligibility.originatingProposal?.currentVersionId ?? null;
    if (originatingVersionId) {
      const lineItems = await crmProposalLineItemRepository.listForVersion(originatingVersionId, tx);
      await crmClientOnboardingServiceItemRepository.createMany(
        onboardingId,
        organizationId,
        lineItems.map((item) => ({ title: item.title, description: item.description, quantity: item.quantity, sourceLineItemId: item.id, onboardingRequired: true, notes: null })),
        tx,
      );
    }

    await crmClientOnboardingChecklistItemRepository.createMany(onboardingId, organizationId, DEFAULT_CHECKLIST_TEMPLATE, tx);

    if (input.assignments) {
      for (const a of input.assignments) {
        await crmClientOnboardingAssignmentRepository.upsert({ organizationId, onboardingId, role: a.role, userId: a.userId, assignedByUserId: context.user!.id }, tx);
      }
    }

    return { onboarding, linkedOrganization, organizationWasCreated };
  });

  await auditOnboarding(context, "crm.onboarding.started", organizationId, onboarding.id, eligibilityResourceName(onboarding));
  await auditOnboarding(context, "crm.onboarding.organization_linked", organizationId, onboarding.id, linkedOrganization.displayName, { organizationId: linkedOrganization.id, wasCreated: organizationWasCreated });

  if (input.assignments) {
    for (const a of input.assignments) {
      await auditOnboarding(context, "crm.onboarding.assigned", organizationId, onboarding.id, a.role);
      await events.emit<CrmOnboardingAssignedPayload>("crm.onboarding.assigned", { onboardingId: onboarding.id, organizationId, recipientUserId: a.userId, companyName: linkedOrganization.displayName, role: a.role });
    }
  }

  return onboarding;
}

function eligibilityResourceName(onboarding: CrmClientOnboarding): string {
  return `Onboarding ${onboarding.id.slice(0, 8)}`;
}

// Payload shapes mirror `subscribers.ts`'s own local copies exactly — same
// convention `crm-proposal-service.ts` already establishes.
interface CrmOnboardingAssignedPayload {
  onboardingId: string;
  organizationId: string;
  recipientUserId: string;
  companyName: string;
  role: string;
}
interface CrmOnboardingRequirementAssignedPayload {
  onboardingId: string;
  organizationId: string;
  recipientUserId: string;
  companyName: string;
  requirementTitle: string;
}
interface CrmOnboardingReadyForKickoffPayload {
  onboardingId: string;
  organizationId: string;
  recipientUserIds: string[];
  companyName: string;
}
interface CrmOnboardingCompletedPayload {
  onboardingId: string;
  organizationId: string;
  recipientUserIds: string[];
  companyName: string;
}

const listOnboardingsSchema = z.object({ status: z.enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"]).optional(), companyId: z.string().uuid().optional(), dealId: z.string().uuid().optional() });

export async function listOnboardings(rawInput: unknown): Promise<CrmClientOnboardingWithRelations[]> {
  const input = parseOrThrow(listOnboardingsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.read");
  const filters: CrmClientOnboardingListFilters = { status: input.status, companyId: input.companyId, dealId: input.dealId };
  return withTenantContext(tenantScope, (tx) => crmClientOnboardingRepository.listForOrganization(organizationId, filters, tx));
}

const onboardingIdSchema = z.object({ onboardingId: z.string().uuid() });

export async function getOnboardingWithRelations(rawInput: unknown): Promise<CrmClientOnboardingWithRelations> {
  const input = parseOrThrow(onboardingIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.read");
  const onboarding = await withTenantContext(tenantScope, (tx) => crmClientOnboardingRepository.findByIdWithRelations(input.onboardingId, tx));
  if (!onboarding || onboarding.organizationId !== organizationId) throw new NotFoundError("Onboarding");
  return onboarding;
}

export interface OnboardingDetail {
  onboarding: CrmClientOnboardingWithRelations;
  progress: OnboardingProgress;
  completion: CompletionCriteriaResult;
  readyForKickoff: boolean;
  serviceItems: Awaited<ReturnType<typeof crmClientOnboardingServiceItemRepository.listForOnboarding>>;
  intakeFields: Awaited<ReturnType<typeof crmClientOnboardingIntakeFieldRepository.listForOrganization>>;
  intakeResponses: Awaited<ReturnType<typeof crmClientOnboardingIntakeResponseRepository.listForOnboarding>>;
  requirements: Awaited<ReturnType<typeof crmClientOnboardingRequirementRepository.listForOnboarding>>;
  checklistItems: Awaited<ReturnType<typeof crmClientOnboardingChecklistItemRepository.listForOnboarding>>;
  documents: Awaited<ReturnType<typeof crmClientOnboardingDocumentRepository.listForOnboarding>>;
  assignments: Awaited<ReturnType<typeof crmClientOnboardingAssignmentRepository.listForOnboarding>>;
}

/**
 * The full detail view (decision #28 — every field Customer 360 will
 * eventually need, resolved together in one call). Progress/completion
 * are computed server-side, every time, from the actual persisted
 * state — never trusted from a client or stored as a bare flag.
 */
export async function getOnboardingDetail(rawInput: unknown): Promise<OnboardingDetail> {
  const input = parseOrThrow(onboardingIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.read");

  return withTenantContext(tenantScope, async (tx) => {
    const onboarding = await crmClientOnboardingRepository.findByIdWithRelations(input.onboardingId, tx);
    if (!onboarding || onboarding.organizationId !== organizationId) throw new NotFoundError("Onboarding");

    const [serviceItems, intakeFields, intakeResponses, requirements, checklistItems, documents, assignments] = await Promise.all([
      crmClientOnboardingServiceItemRepository.listForOnboarding(input.onboardingId, tx),
      crmClientOnboardingIntakeFieldRepository.listForOrganization(organizationId, "ACTIVE", tx),
      crmClientOnboardingIntakeResponseRepository.listForOnboarding(input.onboardingId, tx),
      crmClientOnboardingRequirementRepository.listForOnboarding(input.onboardingId, tx),
      crmClientOnboardingChecklistItemRepository.listForOnboarding(input.onboardingId, tx),
      crmClientOnboardingDocumentRepository.listForOnboarding(input.onboardingId, tx),
      crmClientOnboardingAssignmentRepository.listForOnboarding(input.onboardingId, tx),
    ]);

    const progress = calculateProgress(checklistItems);
    const completion = evaluateCompletionCriteria({
      intakeFields,
      intakeResponses,
      requirements,
      checklistItems,
      kickoffScheduledAt: onboarding.kickoffScheduledAt,
      kickoffCompletedAt: onboarding.kickoffCompletedAt,
    });
    const readyForKickoff = isReadyForKickoff(completion, onboarding.kickoffScheduledAt);

    return { onboarding, progress, completion, readyForKickoff, serviceItems, intakeFields, intakeResponses, requirements, checklistItems, documents, assignments };
  });
}

const setStatusSchema = z.object({ onboardingId: z.string().uuid(), status: z.enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED"]) });

/** Ordinary, non-terminal status transitions only — COMPLETED/CANCELLED always go through their own dedicated, CAS-guarded functions below. */
export async function setOnboardingStatus(rawInput: unknown): Promise<CrmClientOnboarding> {
  const input = parseOrThrow(setStatusSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");

  return withTenantContext(tenantScope, async (tx) => {
    await lockActiveOnboarding(input.onboardingId, organizationId, tx);
    const updated = await crmClientOnboardingRepository.setStatus(input.onboardingId, input.status as CrmClientOnboardingStatus, tx);
    if (!updated) throw new ConflictError("This onboarding has already reached a terminal state.");
    return updated;
  });
}

const scheduleKickoffSchema = z.object({ onboardingId: z.string().uuid(), scheduledAt: z.coerce.date(), notes: z.string().max(2000).nullable().optional(), ownerUserId: z.string().uuid().nullable().optional() });

export async function scheduleKickoff(rawInput: unknown): Promise<CrmClientOnboarding> {
  const input = parseOrThrow(scheduleKickoffSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");

  const onboarding = await withTenantContext(tenantScope, async (tx) => {
    await lockActiveOnboarding(input.onboardingId, organizationId, tx);
    if (input.ownerUserId) await assertPlatformStaffMember(input.ownerUserId, organizationId, tx);
    return crmClientOnboardingRepository.setKickoffScheduled(input.onboardingId, input.scheduledAt, input.notes ?? null, input.ownerUserId ?? null, tx);
  });

  await auditOnboarding(context, "crm.onboarding.kickoff_scheduled", organizationId, onboarding.id, eligibilityResourceName(onboarding));
  return onboarding;
}

export async function completeKickoff(rawInput: unknown): Promise<CrmClientOnboarding> {
  const input = parseOrThrow(onboardingIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");

  const onboarding = await withTenantContext(tenantScope, async (tx) => {
    const existing = await lockActiveOnboarding(input.onboardingId, organizationId, tx);
    if (!existing.kickoffScheduledAt) throw new ValidationError("No kickoff has been scheduled for this onboarding yet.");
    const updated = await crmClientOnboardingRepository.completeKickoff(input.onboardingId, tx);
    if (!updated) throw new ConflictError("This onboarding's kickoff was already marked complete.");
    return updated;
  });

  await auditOnboarding(context, "crm.onboarding.kickoff_completed", organizationId, onboarding.id, eligibilityResourceName(onboarding));
  return onboarding;
}

// `.trim()` runs before `.min(1)` (Codex Security Engineer finding #6) —
// a whitespace-only reason is not a real reason; without this a client
// could satisfy `.min(1)` with e.g. a single space and produce an audit
// record with no actual explanation.
const reasonSchema = z.string().trim().min(1, "A reason is required.").max(1000);
const cancelOnboardingSchema = z.object({ onboardingId: z.string().uuid(), reason: reasonSchema });

export async function cancelOnboarding(rawInput: unknown): Promise<CrmClientOnboarding> {
  const input = parseOrThrow(cancelOnboardingSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");

  const onboarding = await withTenantContext(tenantScope, async (tx) => {
    await lockOnboarding(input.onboardingId, organizationId, tx);
    const updated = await crmClientOnboardingRepository.transitionTerminal(
      input.onboardingId,
      ["NOT_STARTED", "IN_PROGRESS", "BLOCKED"],
      { status: "CANCELLED", cancelledAt: new Date(), cancelledByUserId: context.user!.id, cancelledReason: input.reason },
      tx,
    );
    if (!updated) throw new ConflictError("This onboarding has already reached a terminal state.");
    return updated;
  });

  await auditOnboarding(context, "crm.onboarding.cancelled", organizationId, onboarding.id, eligibilityResourceName(onboarding), { reason: input.reason });
  return onboarding;
}

const completeOnboardingSchema = z.object({ onboardingId: z.string().uuid() });

/**
 * Ordinary, criteria-met completion — refuses outright if any required
 * gate is unmet (see `evaluateCompletionCriteria()`). Use
 * `forceCompleteOnboarding()` for the privileged override path.
 *
 * Locks the onboarding row (`lockOnboarding()`) BEFORE reading any of the
 * completion-criteria inputs (Codex Security Engineer finding #3): every
 * child-record mutation that could affect those criteria
 * (`completeRequirement`, `completeChecklistItem`, `recordIntakeResponse`,
 * etc.) takes the same row lock via `lockActiveOnboarding()` before it
 * writes, so none of them can commit while this function holds the lock —
 * the criteria this function reads are guaranteed to still be the exact
 * criteria in effect at the moment of the CAS write below, not a stale
 * snapshot a concurrent write could invalidate in between.
 */
export async function completeOnboarding(rawInput: unknown): Promise<CrmClientOnboarding> {
  const input = parseOrThrow(completeOnboardingSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");

  const onboarding = await withTenantContext(tenantScope, async (tx) => {
    const existing = await lockOnboarding(input.onboardingId, organizationId, tx);

    const [intakeFields, intakeResponses, requirements, checklistItems] = await Promise.all([
      crmClientOnboardingIntakeFieldRepository.listForOrganization(organizationId, "ACTIVE", tx),
      crmClientOnboardingIntakeResponseRepository.listForOnboarding(input.onboardingId, tx),
      crmClientOnboardingRequirementRepository.listForOnboarding(input.onboardingId, tx),
      crmClientOnboardingChecklistItemRepository.listForOnboarding(input.onboardingId, tx),
    ]);
    const criteria = evaluateCompletionCriteria({ intakeFields, intakeResponses, requirements, checklistItems, kickoffScheduledAt: existing.kickoffScheduledAt, kickoffCompletedAt: existing.kickoffCompletedAt });
    if (!criteria.met) {
      throw new ValidationError(`This onboarding cannot be completed yet — unmet: ${criteria.unmet.join(", ")}. Use the override path if this is genuinely intentional.`);
    }

    const updated = await crmClientOnboardingRepository.transitionTerminal(
      input.onboardingId,
      ["NOT_STARTED", "IN_PROGRESS", "BLOCKED"],
      { status: "COMPLETED", completedAt: new Date(), completedByUserId: context.user!.id, completionOverride: false, completionOverrideReason: null },
      tx,
    );
    if (!updated) throw new ConflictError("This onboarding has already reached a terminal state.");
    return updated;
  });

  await auditOnboarding(context, "crm.onboarding.completed", organizationId, onboarding.id, eligibilityResourceName(onboarding));
  await notifyOnboardingCompleted(onboarding.id, organizationId, tenantScope);
  return onboarding;
}

/** Shared by both the ordinary and privileged-override completion paths — notifies every current assignee, resolved fresh (not cached from earlier in the request) so a just-reassigned role's new holder is the one notified. */
async function notifyOnboardingCompleted(onboardingId: string, organizationId: string, tenantScope: Parameters<typeof withTenantContext>[0]): Promise<void> {
  const [onboardingWithRelations, assignments] = await withTenantContext(tenantScope, (tx) => Promise.all([crmClientOnboardingRepository.findByIdWithRelations(onboardingId, tx), crmClientOnboardingAssignmentRepository.listForOnboarding(onboardingId, tx)]));
  if (!onboardingWithRelations) return;
  const recipientUserIds = [...new Set(assignments.map((a) => a.userId))];
  if (recipientUserIds.length === 0) return;
  await events.emit<CrmOnboardingCompletedPayload>("crm.onboarding.completed", { onboardingId, organizationId, recipientUserIds, companyName: onboardingWithRelations.company.name });
}

const forceCompleteOnboardingSchema = z.object({ onboardingId: z.string().uuid(), reason: reasonSchema });

/** The privileged override (`crm.onboarding.complete`, separate from `.manage`) — forces completion despite incomplete required work. Reason is required and always audited under a DISTINCT action (`crm.onboarding.completed_override`) from an ordinary completion, so this is never confused with a genuine criteria-met completion in the audit log. */
export async function forceCompleteOnboarding(rawInput: unknown): Promise<CrmClientOnboarding> {
  const input = parseOrThrow(forceCompleteOnboardingSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.complete");

  const onboarding = await withTenantContext(tenantScope, async (tx) => {
    await lockOnboarding(input.onboardingId, organizationId, tx);
    const updated = await crmClientOnboardingRepository.transitionTerminal(
      input.onboardingId,
      ["NOT_STARTED", "IN_PROGRESS", "BLOCKED"],
      { status: "COMPLETED", completedAt: new Date(), completedByUserId: context.user!.id, completionOverride: true, completionOverrideReason: input.reason },
      tx,
    );
    if (!updated) throw new ConflictError("This onboarding has already reached a terminal state.");
    return updated;
  });

  await auditOnboarding(context, "crm.onboarding.completed_override", organizationId, onboarding.id, eligibilityResourceName(onboarding), { reason: input.reason });
  await notifyOnboardingCompleted(onboarding.id, organizationId, tenantScope);
  return onboarding;
}

const assignSchema = z.object({ onboardingId: z.string().uuid(), role: z.enum(["ACCOUNT_MANAGER", "ONBOARDING_OWNER", "SERVICE_LEAD"]), userId: z.string().uuid() });

export async function assignOnboardingRole(rawInput: unknown): Promise<void> {
  const input = parseOrThrow(assignSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");

  const { onboarding } = await withTenantContext(tenantScope, async (tx) => {
    await lockActiveOnboarding(input.onboardingId, organizationId, tx);
    // Re-verified inside the same transaction, immediately before the
    // write (Codex Security Engineer finding #5) — the earlier design ran
    // this check outside the transaction entirely, leaving a window where
    // the user's own membership could be revoked between the check and
    // the write.
    await assertPlatformStaffMember(input.userId, organizationId, tx);
    const onboarding = await crmClientOnboardingRepository.findByIdWithRelations(input.onboardingId, tx);
    if (!onboarding) throw new NotFoundError("Onboarding");
    await crmClientOnboardingAssignmentRepository.upsert({ organizationId, onboardingId: input.onboardingId, role: input.role, userId: input.userId, assignedByUserId: context.user!.id }, tx);
    return { onboarding };
  });

  await auditOnboarding(context, "crm.onboarding.assigned", organizationId, onboarding.id, input.role);
  await events.emit<CrmOnboardingAssignedPayload>("crm.onboarding.assigned", { onboardingId: onboarding.id, organizationId, recipientUserId: input.userId, companyName: onboarding.company.name, role: input.role });
}

export type { CrmOnboardingAssignedPayload, CrmOnboardingRequirementAssignedPayload, CrmOnboardingReadyForKickoffPayload, CrmOnboardingCompletedPayload };
export { listUsersWithPermission };
