import "server-only";
import type { CrmContract, CrmContractStatus, CrmCompany, User } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export type CrmContractWithRelations = CrmContract & {
  company: Pick<CrmCompany, "id" | "name">;
  createdByUser: Pick<User, "id" | "name">;
};

const RELATIONS_INCLUDE = {
  company: { select: { id: true, name: true } },
  createdByUser: { select: { id: true, name: true } },
} as const;

export interface CrmContractListFilters {
  dealId?: string;
  companyId?: string;
  status?: CrmContractStatus;
}

/**
 * Data access for `CrmContract` — RLS-protected. Represents the
 * commercial agreement itself, not a document store (see the model's
 * own schema comment): either originated from an accepted proposal
 * version, or a manually recorded agreement — never both null/set
 * inconsistently (CHECK + relationship-integrity trigger).
 */
export const crmContractRepository = {
  async create(
    input: {
      id: string;
      organizationId: string;
      dealId: string;
      companyId: string;
      originatingProposalId: string | null;
      originatingProposalVersionId: string | null;
      contractNumber: string;
      effectiveDate: Date | null;
      endDate: Date | null;
      renewalTerms: string | null;
      createdByUserId: string;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmContract> {
    return withDbErrorTranslation(() =>
      tx.crmContract.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          dealId: input.dealId,
          companyId: input.companyId,
          originatingProposalId: input.originatingProposalId,
          originatingProposalVersionId: input.originatingProposalVersionId,
          contractNumber: input.contractNumber,
          effectiveDate: input.effectiveDate,
          endDate: input.endDate,
          renewalTerms: input.renewalTerms,
          createdByUserId: input.createdByUserId,
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmContract | null> {
    return withDbErrorTranslation(() => tx.crmContract.findUnique({ where: { id } }));
  },

  async findByIdWithRelations(id: string, tx: TransactionClient | typeof db = db): Promise<CrmContractWithRelations | null> {
    return withDbErrorTranslation(() => tx.crmContract.findUnique({ where: { id }, include: RELATIONS_INCLUDE }));
  },

  /** Bounded to 200 — same realistic-total assumption `crmProposalRepository.listForOrganization()` and `crmDealRepository`'s own list methods already document. */
  async listForOrganization(organizationId: string, filters: CrmContractListFilters = {}, tx: TransactionClient | typeof db = db): Promise<CrmContractWithRelations[]> {
    return withDbErrorTranslation(() =>
      tx.crmContract.findMany({
        where: {
          organizationId,
          ...(filters.dealId ? { dealId: filters.dealId } : {}),
          ...(filters.companyId ? { companyId: filters.companyId } : {}),
          ...(filters.status ? { status: filters.status } : {}),
        },
        include: RELATIONS_INCLUDE,
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    );
  },

  async update(id: string, data: Partial<{ effectiveDate: Date | null; endDate: Date | null; renewalTerms: string | null }>, tx: TransactionClient | typeof db = db): Promise<CrmContract> {
    return withDbErrorTranslation(() => tx.crmContract.update({ where: { id }, data }));
  },

  /** DRAFT -> ACTIVE. CAS-guarded — mirrors `crmProposalRepository.transitionTerminal()`'s own shape. */
  async activate(id: string, effectiveDate: Date, tx: TransactionClient | typeof db = db): Promise<CrmContract | null> {
    const result = await withDbErrorTranslation(() =>
      tx.crmContract.updateMany({ where: { id, status: "DRAFT" }, data: { status: "ACTIVE", activatedAt: new Date(), effectiveDate } }),
    );
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmContract.findUnique({ where: { id } }));
  },

  /** ACTIVE -> TERMINATED. CAS-guarded — a contract can only be terminated while it is actually in force. */
  async terminate(id: string, reason: string, tx: TransactionClient | typeof db = db): Promise<CrmContract | null> {
    const result = await withDbErrorTranslation(() =>
      tx.crmContract.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "TERMINATED", terminatedAt: new Date(), terminatedReason: reason } }),
    );
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmContract.findUnique({ where: { id } }));
  },

  /** DRAFT -> CANCELLED. CAS-guarded — cancellation is the DRAFT-only terminal exit (an ACTIVE contract that needs to end uses `terminate()` instead, preserving that it was genuinely in force for a period). */
  async cancel(id: string, tx: TransactionClient | typeof db = db): Promise<CrmContract | null> {
    const result = await withDbErrorTranslation(() => tx.crmContract.updateMany({ where: { id, status: "DRAFT" }, data: { status: "CANCELLED", cancelledAt: new Date() } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmContract.findUnique({ where: { id } }));
  },

  /** ACTIVE -> EXPIRED. CAS-guarded — driven by `endDate` passing, not a user action; kept separate from `terminate()` since expiry is a natural end, not an early one. */
  async expire(id: string, tx: TransactionClient | typeof db = db): Promise<CrmContract | null> {
    const result = await withDbErrorTranslation(() => tx.crmContract.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "EXPIRED" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmContract.findUnique({ where: { id } }));
  },
};
