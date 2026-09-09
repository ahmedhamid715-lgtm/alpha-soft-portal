import "server-only";
import type { CrmClientOnboarding, CrmClientOnboardingStatus, CrmCompany, CrmDeal, Organization, User } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export type CrmClientOnboardingWithRelations = CrmClientOnboarding & {
  deal: Pick<CrmDeal, "id" | "title">;
  company: Pick<CrmCompany, "id" | "name">;
  linkedOrganization: Pick<Organization, "id" | "name" | "displayName" | "slug">;
  kickoffOwnerUser: Pick<User, "id" | "name"> | null;
};

const RELATIONS_INCLUDE = {
  deal: { select: { id: true, title: true } },
  company: { select: { id: true, name: true } },
  linkedOrganization: { select: { id: true, name: true, displayName: true, slug: true } },
  kickoffOwnerUser: { select: { id: true, name: true } },
} as const;

export interface CrmClientOnboardingListFilters {
  status?: CrmClientOnboardingStatus;
  companyId?: string;
  dealId?: string;
  /** Build 26 (Customer Portal) — the reverse lookup a customer's own portal context needs: "which onboarding(s) target MY organization." `linkedOrganizationId` is the canonical, required (never null) bridge field — see the model's own doc comment. */
  linkedOrganizationId?: string;
}

/**
 * Data access for `CrmClientOnboarding` (Build 23 — Roadmap Module 17) —
 * RLS-protected, owned by the platform organization exclusively (see the
 * schema's own top-of-block comment). No DELETE anywhere in this domain —
 * every mutation is an ordinary update-in-place or a CAS-guarded status
 * transition, the same discipline `crmContractRepository`'s own lifecycle
 * methods establish, deliberately chosen to avoid the exact class of bug
 * Build 22's own security review found (a DELETE/RLS mismatch from a
 * delete-then-recreate pattern) by simply never needing DELETE at all.
 */
export const crmClientOnboardingRepository = {
  async create(
    input: {
      id: string;
      organizationId: string;
      dealId: string;
      companyId: string;
      linkedOrganizationId: string;
      originatingContractId: string | null;
      originatingProposalId: string | null;
      createdByUserId: string;
      /** Defaults to the schema's own `NOT_STARTED`. `convertDealToClient()` passes `IN_PROGRESS` directly here instead of creating as `NOT_STARTED` and immediately following up with a separate `setStatus()` call (Codex Performance Engineer review — that extra call was a wasted CAS `updateMany` + `findUnique` round trip whose own return value was discarded anyway). */
      status?: CrmClientOnboardingStatus;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmClientOnboarding> {
    return withDbErrorTranslation(() =>
      tx.crmClientOnboarding.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          dealId: input.dealId,
          companyId: input.companyId,
          linkedOrganizationId: input.linkedOrganizationId,
          originatingContractId: input.originatingContractId,
          originatingProposalId: input.originatingProposalId,
          createdByUserId: input.createdByUserId,
          ...(input.status ? { status: input.status } : {}),
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboarding | null> {
    return withDbErrorTranslation(() => tx.crmClientOnboarding.findUnique({ where: { id } }));
  },

  async findByIdWithRelations(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingWithRelations | null> {
    return withDbErrorTranslation(() => tx.crmClientOnboarding.findUnique({ where: { id }, include: RELATIONS_INCLUDE }));
  },

  /**
   * Row-locked read — mirrors `paymentRepository.findByIdLocked()`'s own
   * shape/reasoning exactly. MUST be called inside a transaction. This is
   * the mutual-exclusion mechanism `crm-client-onboarding-service.ts`'s own
   * `lockActiveOnboarding()` builds on: every mutation anywhere in this
   * domain (status changes, kickoff, terminal transitions, AND every
   * child-record write — requirements/checklist/documents/intake
   * responses/assignments) locks this same row before writing, so two
   * concurrent mutations against the same onboarding always serialize
   * rather than interleave. This is what closes the Codex Security
   * Engineer's findings #1 (a status update racing a terminal transition
   * could resurrect a completed/cancelled onboarding), #2 (child-record
   * writes had no terminal-state guard at all), and #3 (completion
   * criteria could go stale between being evaluated and the CAS write,
   * because nothing prevented a concurrent child-record mutation from
   * committing in between) in one mechanism, rather than three separate
   * patches.
   */
  async findByIdLocked(id: string, tx: TransactionClient): Promise<CrmClientOnboarding | null> {
    const locked = await withDbErrorTranslation(() => tx.$queryRaw<{ id: string }[]>`SELECT id FROM crm_client_onboardings WHERE id = ${id}::uuid FOR UPDATE`);
    if (!locked[0]) return null;
    return withDbErrorTranslation(() => tx.crmClientOnboarding.findUnique({ where: { id: locked[0]!.id } }));
  },

  /** The active (non-CANCELLED) onboarding for a deal, if any — mirrors the DB's own partial unique index (`crm_client_onboardings_one_active_per_deal`); used both for the eligibility "no conflicting active onboarding" check and for resolving "this deal's current onboarding." */
  async findActiveForDeal(dealId: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboarding | null> {
    return withDbErrorTranslation(() => tx.crmClientOnboarding.findFirst({ where: { dealId, status: { not: "CANCELLED" } } }));
  },

  /** Bounded to 200 — same realistic-total assumption every prior CRM list repository documents. */
  async listForOrganization(organizationId: string, filters: CrmClientOnboardingListFilters = {}, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingWithRelations[]> {
    return withDbErrorTranslation(() =>
      tx.crmClientOnboarding.findMany({
        where: {
          organizationId,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.companyId ? { companyId: filters.companyId } : {}),
          ...(filters.dealId ? { dealId: filters.dealId } : {}),
          ...(filters.linkedOrganizationId ? { linkedOrganizationId: filters.linkedOrganizationId } : {}),
        },
        include: RELATIONS_INCLUDE,
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    );
  },

  /**
   * Ordinary status transition (NOT_STARTED -> IN_PROGRESS, or ->
   * BLOCKED/back) — CAS-guarded on `status NOT IN (COMPLETED, CANCELLED)`
   * as a data-layer backstop (Codex Security Engineer finding #1: a
   * status update racing a concurrent terminal transition could otherwise
   * resurrect a just-completed/cancelled onboarding). Every call site also
   * locks the row first via `findByIdLocked()` — this CAS is defense in
   * depth, not the only guard. Returns `null` on a lost race.
   */
  async setStatus(id: string, status: CrmClientOnboardingStatus, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboarding | null> {
    const result = await withDbErrorTranslation(() => tx.crmClientOnboarding.updateMany({ where: { id, status: { notIn: ["COMPLETED", "CANCELLED"] } }, data: { status } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmClientOnboarding.findUnique({ where: { id } }));
  },

  async setKickoffScheduled(id: string, scheduledAt: Date, notes: string | null, ownerUserId: string | null, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboarding> {
    return withDbErrorTranslation(() => tx.crmClientOnboarding.update({ where: { id }, data: { kickoffScheduledAt: scheduledAt, kickoffNotes: notes, kickoffOwnerUserId: ownerUserId } }));
  },

  /** CAS-guarded on `kickoffCompletedAt IS NULL` — a lost race (already completed) returns `null`. */
  async completeKickoff(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboarding | null> {
    const result = await withDbErrorTranslation(() => tx.crmClientOnboarding.updateMany({ where: { id, kickoffCompletedAt: null }, data: { kickoffCompletedAt: new Date() } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmClientOnboarding.findUnique({ where: { id } }));
  },

  /** Compare-and-swap terminal transition (COMPLETED/CANCELLED) — `expectedStatuses` guards against a concurrent double-transition (completion racing cancellation, or a double-submit of either). Mirrors `crmContractRepository`'s own `activate()`/`terminate()` CAS shape. */
  async transitionTerminal(
    id: string,
    expectedStatuses: CrmClientOnboardingStatus[],
    data:
      | { status: "COMPLETED"; completedAt: Date; completedByUserId: string; completionOverride: boolean; completionOverrideReason: string | null }
      | { status: "CANCELLED"; cancelledAt: Date; cancelledByUserId: string; cancelledReason: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmClientOnboarding | null> {
    const result = await withDbErrorTranslation(() => tx.crmClientOnboarding.updateMany({ where: { id, status: { in: expectedStatuses } }, data }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmClientOnboarding.findUnique({ where: { id } }));
  },
};
