import "server-only";
import type { CrmClientSuccessRenewal, CrmClientSuccessRenewalStatus, CrmCompany, CrmContract, User } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export type CrmClientSuccessRenewalWithRelations = CrmClientSuccessRenewal & {
  company: Pick<CrmCompany, "id" | "name">;
  contract: Pick<CrmContract, "id" | "contractNumber" | "status" | "endDate">;
  ownerUser: Pick<User, "id" | "name"> | null;
};

const RELATIONS_INCLUDE = {
  company: { select: { id: true, name: true } },
  contract: { select: { id: true, contractNumber: true, status: true, endDate: true } },
  ownerUser: { select: { id: true, name: true } },
} as const;

export interface CrmClientSuccessRenewalListFilters {
  companyId?: string;
  status?: CrmClientSuccessRenewalStatus;
  /** UPCOMING or IN_PROGRESS — the "queue" a portfolio view actually wants, expressed once here rather than at every call site. */
  openOnly?: boolean;
}

const TERMINAL_STATUSES: CrmClientSuccessRenewalStatus[] = ["RENEWED", "NOT_RENEWING", "EXPIRED"];
const OPEN_STATUSES: CrmClientSuccessRenewalStatus[] = ["UPCOMING", "IN_PROGRESS"];

/**
 * Data access for `CrmClientSuccessRenewal` — upsert/CAS-only, no
 * DELETE (same discipline as every Build 23/25 table). The partial
 * unique index (`crm_client_success_renewals_one_open_per_contract`)
 * and the relationship-integrity trigger (contract must belong to the
 * same company) are the real, structural guarantees; `findOpenForContract()`
 * below is a pre-check for a clean `ConflictError` rather than a raw DB
 * constraint violation, not the guarantee itself.
 */
export const crmClientSuccessRenewalRepository = {
  async create(
    input: { id: string; organizationId: string; companyId: string; contractId: string; renewalDate: Date; ownerUserId: string | null; expectedValueMinorUnits: number | null; expectedValueCurrency: string | null; notes: string | null; createdByUserId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmClientSuccessRenewal> {
    return withDbErrorTranslation(() =>
      tx.crmClientSuccessRenewal.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          companyId: input.companyId,
          contractId: input.contractId,
          renewalDate: input.renewalDate,
          ownerUserId: input.ownerUserId,
          expectedValueMinorUnits: input.expectedValueMinorUnits,
          expectedValueCurrency: input.expectedValueCurrency,
          notes: input.notes,
          createdByUserId: input.createdByUserId,
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientSuccessRenewal | null> {
    return withDbErrorTranslation(() => tx.crmClientSuccessRenewal.findUnique({ where: { id } }));
  },

  async findByIdWithRelations(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientSuccessRenewalWithRelations | null> {
    return withDbErrorTranslation(() => tx.crmClientSuccessRenewal.findUnique({ where: { id }, include: RELATIONS_INCLUDE }));
  },

  /** The one OPEN (non-terminal) renewal for a contract, if any — mirrors the DB's own partial unique index; used both for the pre-check "this contract already has an open renewal" and for resolving "the current renewal." */
  async findOpenForContract(contractId: string, tx: TransactionClient | typeof db = db): Promise<CrmClientSuccessRenewal | null> {
    return withDbErrorTranslation(() => tx.crmClientSuccessRenewal.findFirst({ where: { contractId, status: { in: OPEN_STATUSES } } }));
  },

  async listForCompany(companyId: string, tx: TransactionClient | typeof db = db): Promise<CrmClientSuccessRenewalWithRelations[]> {
    return withDbErrorTranslation(() => tx.crmClientSuccessRenewal.findMany({ where: { companyId }, include: RELATIONS_INCLUDE, orderBy: { renewalDate: "asc" }, take: 50 }));
  },

  /** Bounded to 200 — the portfolio queue, same realistic-total assumption every prior CRM list repository documents. */
  async listForOrganization(organizationId: string, filters: CrmClientSuccessRenewalListFilters = {}, tx: TransactionClient | typeof db = db): Promise<CrmClientSuccessRenewalWithRelations[]> {
    return withDbErrorTranslation(() =>
      tx.crmClientSuccessRenewal.findMany({
        where: {
          organizationId,
          ...(filters.companyId ? { companyId: filters.companyId } : {}),
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.openOnly ? { status: { in: OPEN_STATUSES } } : {}),
        },
        include: RELATIONS_INCLUDE,
        orderBy: { renewalDate: "asc" },
        take: 200,
      }),
    );
  },

  /**
   * CAS-guarded on `status NOT IN (terminal)` — Codex Security Engineer
   * review: a plain `update()` keyed only on `id` could commit AFTER a
   * concurrent `transitionTerminal()` closed this same renewal, silently
   * editing (and in `setInProgress()`'s case, effectively resurrecting)
   * an already-terminal record — the exact race class Build 23's own
   * `setOnboardingStatus()` was found vulnerable to and fixed the same
   * way. Returns `null` on a lost race.
   */
  async update(
    id: string,
    data: Partial<{ renewalDate: Date; ownerUserId: string | null; expectedValueMinorUnits: number | null; expectedValueCurrency: string | null; notes: string | null }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmClientSuccessRenewal | null> {
    const result = await withDbErrorTranslation(() => tx.crmClientSuccessRenewal.updateMany({ where: { id, status: { notIn: TERMINAL_STATUSES } }, data }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmClientSuccessRenewal.findUnique({ where: { id } }));
  },

  /** CAS-guarded on `status = 'UPCOMING'` — see `update()`'s own comment for why this needs a real CAS, not a bare `update()`. Returns `null` on a lost race. */
  async setInProgress(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientSuccessRenewal | null> {
    const result = await withDbErrorTranslation(() => tx.crmClientSuccessRenewal.updateMany({ where: { id, status: "UPCOMING" }, data: { status: "IN_PROGRESS" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmClientSuccessRenewal.findUnique({ where: { id } }));
  },

  /** CAS-guarded terminal transition (RENEWED / NOT_RENEWING / EXPIRED) — `expectedStatuses` guards against a double-submit or a race between two staff members. Returns `null` on a lost race. */
  async transitionTerminal(id: string, expectedStatuses: CrmClientSuccessRenewalStatus[], data: { status: CrmClientSuccessRenewalStatus; outcome: string }, tx: TransactionClient | typeof db = db): Promise<CrmClientSuccessRenewal | null> {
    const result = await withDbErrorTranslation(() => tx.crmClientSuccessRenewal.updateMany({ where: { id, status: { in: expectedStatuses } }, data }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmClientSuccessRenewal.findUnique({ where: { id } }));
  },

  /**
   * Every ACTIVE contract expiring within `withinDays` that has NO open
   * renewal tracking it yet — the portfolio's own "contracts needing a
   * renewal started" queue. Two bounded queries (contracts, then open
   * renewals FOR THOSE SAME CONTRACTS ONLY) plus an in-memory set
   * difference — deliberately NOT a per-contract lookup loop, and simple
   * enough not to need raw SQL. The second query is deliberately
   * SEQUENCED after the first (not run in `Promise.all()`), not because
   * of a data dependency the where-clause needs, but because its own
   * `contractId: { in: ... }` filter is built FROM the first query's own
   * (bounded, at most 200) result — Codex Performance Engineer review:
   * the open-renewals query previously had no bound of its own at all
   * (every open renewal org-wide), even though only ones for these
   * specific expiring contracts could ever matter here.
   */
  async listActiveContractsExpiringWithoutOpenRenewal(organizationId: string, withinDays: number, tx: TransactionClient | typeof db = db): Promise<{ contract: { id: string; contractNumber: string; endDate: Date }; company: { id: string; name: string } }[]> {
    const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);
    const expiring = await withDbErrorTranslation(() =>
      tx.crmContract.findMany({
        where: { organizationId, status: "ACTIVE", endDate: { not: null, lte: cutoff } },
        select: { id: true, contractNumber: true, endDate: true, company: { select: { id: true, name: true } } },
        orderBy: { endDate: "asc" },
        take: 200,
      }),
    );
    if (expiring.length === 0) return [];
    const openRenewals = await withDbErrorTranslation(() =>
      tx.crmClientSuccessRenewal.findMany({ where: { organizationId, status: { in: OPEN_STATUSES }, contractId: { in: expiring.map((c) => c.id) } }, select: { contractId: true } }),
    );
    const openContractIds = new Set(openRenewals.map((r) => r.contractId));
    return expiring
      .filter((c) => !openContractIds.has(c.id))
      .map((c) => ({ contract: { id: c.id, contractNumber: c.contractNumber, endDate: c.endDate! }, company: c.company }));
  },
};

export { TERMINAL_STATUSES as CLIENT_SUCCESS_RENEWAL_TERMINAL_STATUSES, OPEN_STATUSES as CLIENT_SUCCESS_RENEWAL_OPEN_STATUSES };
