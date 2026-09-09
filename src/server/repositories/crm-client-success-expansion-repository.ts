import "server-only";
import type { CrmClientSuccessExpansionOpportunity, CrmClientSuccessExpansionStatus, CrmCompany, CrmDeal, User } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export type CrmClientSuccessExpansionWithRelations = CrmClientSuccessExpansionOpportunity & {
  company: Pick<CrmCompany, "id" | "name">;
  ownerUser: Pick<User, "id" | "name"> | null;
  handedToDeal: Pick<CrmDeal, "id" | "title"> | null;
};

const RELATIONS_INCLUDE = {
  company: { select: { id: true, name: true } },
  ownerUser: { select: { id: true, name: true } },
  handedToDeal: { select: { id: true, title: true } },
} as const;

export interface CrmClientSuccessExpansionListFilters {
  companyId?: string;
  status?: CrmClientSuccessExpansionStatus;
}

const TERMINAL_STATUSES: CrmClientSuccessExpansionStatus[] = ["HANDED_TO_SALES", "DISMISSED"];

/** Data access for `CrmClientSuccessExpansionOpportunity` — upsert/CAS-only, no DELETE. */
export const crmClientSuccessExpansionRepository = {
  async create(
    input: {
      id: string;
      organizationId: string;
      companyId: string;
      title: string;
      rationale: string;
      estimatedValueMinorUnits: number | null;
      estimatedValueCurrency: string | null;
      sourceSignal: string | null;
      notes: string | null;
      ownerUserId: string | null;
      createdByUserId: string;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmClientSuccessExpansionOpportunity> {
    return withDbErrorTranslation(() =>
      tx.crmClientSuccessExpansionOpportunity.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          companyId: input.companyId,
          title: input.title,
          rationale: input.rationale,
          estimatedValueMinorUnits: input.estimatedValueMinorUnits,
          estimatedValueCurrency: input.estimatedValueCurrency,
          sourceSignal: input.sourceSignal,
          notes: input.notes,
          ownerUserId: input.ownerUserId,
          createdByUserId: input.createdByUserId,
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientSuccessExpansionOpportunity | null> {
    return withDbErrorTranslation(() => tx.crmClientSuccessExpansionOpportunity.findUnique({ where: { id } }));
  },

  async findByIdWithRelations(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientSuccessExpansionWithRelations | null> {
    return withDbErrorTranslation(() => tx.crmClientSuccessExpansionOpportunity.findUnique({ where: { id }, include: RELATIONS_INCLUDE }));
  },

  async listForCompany(companyId: string, tx: TransactionClient | typeof db = db): Promise<CrmClientSuccessExpansionWithRelations[]> {
    return withDbErrorTranslation(() => tx.crmClientSuccessExpansionOpportunity.findMany({ where: { companyId }, include: RELATIONS_INCLUDE, orderBy: { identifiedAt: "desc" }, take: 50 }));
  },

  /** Bounded to 200 — the portfolio queue. */
  async listForOrganization(organizationId: string, filters: CrmClientSuccessExpansionListFilters = {}, tx: TransactionClient | typeof db = db): Promise<CrmClientSuccessExpansionWithRelations[]> {
    return withDbErrorTranslation(() =>
      tx.crmClientSuccessExpansionOpportunity.findMany({
        where: { organizationId, ...(filters.companyId ? { companyId: filters.companyId } : {}), ...(filters.status ? { status: filters.status } : {}) },
        include: RELATIONS_INCLUDE,
        orderBy: { identifiedAt: "desc" },
        take: 200,
      }),
    );
  },

  /**
   * CAS-guarded on `status NOT IN (terminal)` — same race/fix as
   * `crmClientSuccessRenewalRepository.update()` (Codex Security
   * Engineer review). Returns `null` on a lost race.
   */
  async update(
    id: string,
    data: Partial<{ title: string; rationale: string; estimatedValueMinorUnits: number | null; estimatedValueCurrency: string | null; sourceSignal: string | null; notes: string | null; ownerUserId: string | null }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmClientSuccessExpansionOpportunity | null> {
    const result = await withDbErrorTranslation(() => tx.crmClientSuccessExpansionOpportunity.updateMany({ where: { id, status: { notIn: TERMINAL_STATUSES } }, data }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmClientSuccessExpansionOpportunity.findUnique({ where: { id } }));
  },

  /** CAS-guarded on `status = 'IDENTIFIED'` — see `update()`'s own comment. Returns `null` on a lost race. */
  async setQualified(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientSuccessExpansionOpportunity | null> {
    const result = await withDbErrorTranslation(() => tx.crmClientSuccessExpansionOpportunity.updateMany({ where: { id, status: "IDENTIFIED" }, data: { status: "QUALIFIED" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmClientSuccessExpansionOpportunity.findUnique({ where: { id } }));
  },

  /** CAS-guarded terminal transition (HANDED_TO_SALES / DISMISSED). `handedToDealId` is only ever set here, alongside the transition to HANDED_TO_SALES — never independently, and never auto-populated. Returns `null` on a lost race. */
  async transitionTerminal(
    id: string,
    expectedStatuses: CrmClientSuccessExpansionStatus[],
    data: { status: CrmClientSuccessExpansionStatus; handedToDealId?: string | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmClientSuccessExpansionOpportunity | null> {
    const result = await withDbErrorTranslation(() => tx.crmClientSuccessExpansionOpportunity.updateMany({ where: { id, status: { in: expectedStatuses } }, data }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmClientSuccessExpansionOpportunity.findUnique({ where: { id } }));
  },
};

export { TERMINAL_STATUSES as CLIENT_SUCCESS_EXPANSION_TERMINAL_STATUSES };
