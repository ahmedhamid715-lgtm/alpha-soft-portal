import "server-only";
import type { CrmProposal, CrmProposalStatus, CrmCompany, CrmContact, User } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export type CrmProposalWithRelations = CrmProposal & {
  company: Pick<CrmCompany, "id" | "name">;
  primaryContact: Pick<CrmContact, "id" | "firstName" | "lastName"> | null;
  assignedToUser: Pick<User, "id" | "name"> | null;
};

const RELATIONS_INCLUDE = {
  company: { select: { id: true, name: true } },
  primaryContact: { select: { id: true, firstName: true, lastName: true } },
  assignedToUser: { select: { id: true, name: true } },
} as const;

export interface CrmProposalListFilters {
  dealId?: string;
  companyId?: string;
  status?: CrmProposalStatus;
  assignedToUserId?: string;
}

/**
 * Data access for `CrmProposal` — RLS-protected. The proposal ROOT never
 * carries commercial content itself (see `CrmProposalVersion`) — this
 * repository's own `update()` is deliberately narrow (status/current-
 * version-pointer/assignee only), never the version's own fields.
 */
export const crmProposalRepository = {
  async create(
    input: { id: string; organizationId: string; dealId: string; companyId: string; primaryContactId: string | null; proposalNumber: string; templateId: string | null; assignedToUserId: string | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmProposal> {
    return withDbErrorTranslation(() =>
      tx.crmProposal.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          dealId: input.dealId,
          companyId: input.companyId,
          primaryContactId: input.primaryContactId,
          proposalNumber: input.proposalNumber,
          templateId: input.templateId,
          assignedToUserId: input.assignedToUserId,
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmProposal | null> {
    return withDbErrorTranslation(() => tx.crmProposal.findUnique({ where: { id } }));
  },

  async findByIdWithRelations(id: string, tx: TransactionClient | typeof db = db): Promise<CrmProposalWithRelations | null> {
    return withDbErrorTranslation(() => tx.crmProposal.findUnique({ where: { id }, include: RELATIONS_INCLUDE }));
  },

  /** Bounded to 200 — a realistic internal sales team's total proposal count, same assumption `crmDealRepository`'s own list methods already document. */
  async listForOrganization(organizationId: string, filters: CrmProposalListFilters = {}, tx: TransactionClient | typeof db = db): Promise<CrmProposalWithRelations[]> {
    return withDbErrorTranslation(() =>
      tx.crmProposal.findMany({
        where: {
          organizationId,
          ...(filters.dealId ? { dealId: filters.dealId } : {}),
          ...(filters.companyId ? { companyId: filters.companyId } : {}),
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.assignedToUserId ? { assignedToUserId: filters.assignedToUserId } : {}),
        },
        include: RELATIONS_INCLUDE,
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    );
  },

  /** ONLY for the initial `createProposal()` (the version this points to was just created inside the same transaction, and the root has no concurrent readers yet) — every OTHER caller that changes `currentVersionId` also changes `status` and MUST use the CAS `reviseToNewVersion()` below instead. */
  async setCurrentVersion(id: string, currentVersionId: string, tx: TransactionClient | typeof db = db): Promise<CrmProposal> {
    return withDbErrorTranslation(() => tx.crmProposal.update({ where: { id }, data: { currentVersionId } }));
  },

  async setAssignee(id: string, assignedToUserId: string | null, tx: TransactionClient | typeof db = db): Promise<CrmProposal> {
    return withDbErrorTranslation(() => tx.crmProposal.update({ where: { id }, data: { assignedToUserId } }));
  },

  /** Ordinary, single-field status transition (SENT only) — no concurrent second writer can race THIS specific transition, since `sendProposal()`'s own version-level CAS (`markSent()`, guarded on `status = 'DRAFT'`) already fails first and aborts the whole transaction if a race is in flight. Never used for a transition that also changes `currentVersionId` — see `reviseToNewVersion()`. */
  async setStatus(id: string, status: CrmProposalStatus, tx: TransactionClient | typeof db = db): Promise<CrmProposal> {
    return withDbErrorTranslation(() => tx.crmProposal.update({ where: { id }, data: { status } }));
  },

  /**
   * Compare-and-swap revision transition: advances `currentVersionId` to a
   * brand-new version AND moves `status` back to `DRAFT`, together,
   * guarded on the root's own PRE-revise `expectedStatus`. Both fields
   * change in the same guarded write specifically to close a real race
   * Codex's own Build 22 security review found: `reviseProposal()`
   * previously wrote `currentVersionId` and `status` as two independent,
   * unconditional `update()` calls, so a concurrent `acceptProposal()`
   * that committed ACCEPTED in between them was silently overwritten —
   * the root ended up DRAFT/pointing at the new version while the OLD
   * version stayed permanently ACCEPTED, reopening an accepted proposal.
   * A lost race here (count 0) means someone else changed this
   * proposal's status since it was read — the caller surfaces a
   * `ConflictError`, exactly like every other terminal CAS transition.
   */
  async reviseToNewVersion(id: string, expectedStatus: CrmProposalStatus, newCurrentVersionId: string, tx: TransactionClient | typeof db = db): Promise<CrmProposal | null> {
    const result = await withDbErrorTranslation(() => tx.crmProposal.updateMany({ where: { id, status: expectedStatus }, data: { status: "DRAFT", currentVersionId: newCurrentVersionId } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmProposal.findUnique({ where: { id } }));
  },

  /** Compare-and-swap terminal transition (ACCEPTED/REJECTED/EXPIRED) — `expectedStatus` guards against a concurrent double-transition. Mirrors `crmDealRepository`'s own `win()`/`lose()` CAS shape exactly. */
  async transitionTerminal(
    id: string,
    expectedStatus: CrmProposalStatus,
    data: { status: CrmProposalStatus; acceptedAt?: Date; rejectedAt?: Date; expiredAt?: Date },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmProposal | null> {
    const result = await withDbErrorTranslation(() => tx.crmProposal.updateMany({ where: { id, status: expectedStatus }, data }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmProposal.findUnique({ where: { id } }));
  },
};
