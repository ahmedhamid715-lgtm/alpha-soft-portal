import "server-only";
import { Prisma, type CrmDeal, type CrmDealStatus, type CrmCompany, type CrmContact, type User } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { type OffsetPaginationParams, type OffsetPaginatedResult, toOffsetPaginatedResult } from "@/lib/platform/pagination";

export type CrmDealWithRelations = CrmDeal & {
  company: Pick<CrmCompany, "id" | "name">;
  primaryContact: Pick<CrmContact, "id" | "firstName" | "lastName"> | null;
  assignedToUser: Pick<User, "id" | "name"> | null;
};

const RELATIONS_INCLUDE = {
  company: { select: { id: true, name: true } },
  primaryContact: { select: { id: true, firstName: true, lastName: true } },
  assignedToUser: { select: { id: true, name: true } },
} as const;

export interface CrmDealListFilters {
  pipelineId?: string;
  stageId?: string;
  status?: CrmDealStatus;
  companyId?: string;
  assignedToUserId?: string;
  search?: string;
}

export interface CurrencyTotal {
  currency: string;
  totalMinorUnits: number;
}

/**
 * Data access for `CrmDeal` — RLS-protected. `pipelineId`/`stageId`/
 * `companyId` are always required FKs (schema.prisma); `primaryContactId`/
 * `sourceLeadId`/`assignedToUserId` are all optional. Every lifecycle
 * transition method (`moveStage`/`win`/`lose`/`reopen`) is a real
 * compare-and-swap (`updateMany` guarded by the caller's own
 * previously-read expected state, `count === 0` meaning "lost the
 * race") — see crm-deal-service.ts's own comment, the same pattern
 * `crmLeadRepository.changeStatus()`/`crmTaskRepository.complete()`
 * already established in Build 19.
 */
export const crmDealRepository = {
  async create(
    input: {
      id: string;
      organizationId: string;
      pipelineId: string;
      stageId: string;
      companyId: string;
      primaryContactId: string | null;
      sourceLeadId: string | null;
      title: string;
      valueMinorUnits: number;
      currency: string;
      probability: number | null;
      expectedCloseDate: Date | null;
      assignedToUserId: string | null;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmDeal> {
    return withDbErrorTranslation(() =>
      tx.crmDeal.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          pipelineId: input.pipelineId,
          stageId: input.stageId,
          companyId: input.companyId,
          primaryContactId: input.primaryContactId,
          sourceLeadId: input.sourceLeadId,
          title: input.title,
          valueMinorUnits: input.valueMinorUnits,
          currency: input.currency,
          probability: input.probability,
          expectedCloseDate: input.expectedCloseDate,
          assignedToUserId: input.assignedToUserId,
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmDeal | null> {
    return withDbErrorTranslation(() => tx.crmDeal.findUnique({ where: { id } }));
  },

  async findByIdWithRelations(id: string, tx: TransactionClient | typeof db = db): Promise<CrmDealWithRelations | null> {
    return withDbErrorTranslation(() => tx.crmDeal.findUnique({ where: { id }, include: RELATIONS_INCLUDE }));
  },

  async listForOrganization(organizationId: string, params: OffsetPaginationParams, filters: CrmDealListFilters = {}, tx: TransactionClient | typeof db = db): Promise<OffsetPaginatedResult<CrmDeal>> {
    const where = {
      organizationId,
      ...(filters.pipelineId ? { pipelineId: filters.pipelineId } : {}),
      ...(filters.stageId ? { stageId: filters.stageId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.companyId ? { companyId: filters.companyId } : {}),
      ...(filters.assignedToUserId ? { assignedToUserId: filters.assignedToUserId } : {}),
      ...(filters.search ? { title: { contains: filters.search, mode: "insensitive" as const } } : {}),
    };
    const [items, totalCount] = await withDbErrorTranslation(() =>
      Promise.all([tx.crmDeal.findMany({ where, orderBy: { createdAt: "desc" }, skip: (params.page - 1) * params.limit, take: params.limit }), tx.crmDeal.count({ where })]),
    );
    return toOffsetPaginatedResult(items, params, totalCount);
  },

  /** The full board view for one pipeline — every OPEN deal, ordered for stable column rendering, with company/contact/assignee display data joined in the original query (never an N+1 per card). Bounded to 500 (a realistic internal sales team's total open deal count; revisit with real pagination if this module ever needs more). */
  async listOpenForPipeline(organizationId: string, pipelineId: string, tx: TransactionClient | typeof db = db): Promise<CrmDealWithRelations[]> {
    return withDbErrorTranslation(() => tx.crmDeal.findMany({ where: { organizationId, pipelineId, status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 500, include: RELATIONS_INCLUDE }));
  },

  async update(
    id: string,
    data: Partial<{ title: string; valueMinorUnits: number; currency: string; probability: number | null; expectedCloseDate: Date | null; primaryContactId: string | null }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmDeal> {
    return withDbErrorTranslation(() => tx.crmDeal.update({ where: { id }, data }));
  },

  async changeOwner(id: string, assignedToUserId: string | null, tx: TransactionClient | typeof db = db): Promise<CrmDeal> {
    return withDbErrorTranslation(() => tx.crmDeal.update({ where: { id }, data: { assignedToUserId } }));
  },

  /** Ordinary stage move — `expectedStageId` guards against a concurrent move already having happened. Rejects (via the service, which checks the target stage first) moving into an `isWon`/`isLost` stage; `winDeal()`/`loseDeal()` are the only path there. */
  async moveStage(id: string, stageId: string, expectedStageId: string, tx: TransactionClient | typeof db = db): Promise<CrmDeal | null> {
    const result = await withDbErrorTranslation(() => tx.crmDeal.updateMany({ where: { id, stageId: expectedStageId, status: "OPEN" }, data: { stageId } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmDeal.findUnique({ where: { id } }));
  },

  async win(id: string, stageId: string, tx: TransactionClient | typeof db = db): Promise<CrmDeal | null> {
    const result = await withDbErrorTranslation(() => tx.crmDeal.updateMany({ where: { id, status: "OPEN" }, data: { status: "WON", stageId, wonAt: new Date(), lostAt: null, lossReason: null } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmDeal.findUnique({ where: { id } }));
  },

  async lose(id: string, stageId: string, lossReason: string, tx: TransactionClient | typeof db = db): Promise<CrmDeal | null> {
    const result = await withDbErrorTranslation(() => tx.crmDeal.updateMany({ where: { id, status: "OPEN" }, data: { status: "LOST", stageId, lostAt: new Date(), wonAt: null, lossReason } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmDeal.findUnique({ where: { id } }));
  },

  /** `expectedStatus` is always `"WON"` or `"LOST"` — reopening a still-OPEN deal is a service-level no-op guard, not a DB race to protect against. */
  async reopen(id: string, stageId: string, expectedStatus: "WON" | "LOST", tx: TransactionClient | typeof db = db): Promise<CrmDeal | null> {
    const result = await withDbErrorTranslation(() =>
      tx.crmDeal.updateMany({ where: { id, status: expectedStatus }, data: { status: "OPEN", stageId, wonAt: null, lostAt: null, lossReason: null } }),
    );
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmDeal.findUnique({ where: { id } }));
  },

  // --- Forecasting — aggregated in Postgres, never by loading every deal
  // into JavaScript. Multi-currency amounts are grouped by currency, never
  // fake-converted — see crm-deal-forecast-service.ts's own top comment.

  /** Sum of OPEN deal values, grouped by currency. */
  async pipelineValueByCurrency(organizationId: string, pipelineId: string | undefined, tx: TransactionClient | typeof db = db): Promise<CurrencyTotal[]> {
    const grouped = await withDbErrorTranslation(() =>
      tx.crmDeal.groupBy({ by: ["currency"], where: { organizationId, status: "OPEN", ...(pipelineId ? { pipelineId } : {}) }, _sum: { valueMinorUnits: true } }),
    );
    return grouped.map((g) => ({ currency: g.currency, totalMinorUnits: g._sum.valueMinorUnits ?? 0 }));
  },

  /** Sum of (value × probability / 100) for OPEN deals with a set probability, grouped by currency — a raw aggregate query (Prisma's `groupBy` can't express a computed-column SUM). Deals with a null probability are excluded here (never assumed 0 or 100 — see `excludedFromWeightedCount` below for their own honest count). */
  async weightedForecastByCurrency(organizationId: string, pipelineId: string | undefined, tx: TransactionClient | typeof db = db): Promise<CurrencyTotal[]> {
    // `Prisma.sql`/`Prisma.empty` compose safely (parameterized, no
    // string concatenation) — a plain template-literal ternary cannot
    // nest another tagged-template call as a fragment.
    const pipelineFilter = pipelineId ? Prisma.sql`AND pipeline_id = ${pipelineId}::uuid` : Prisma.empty;
    // `::bigint` on both operands before multiplying — confirmed by
    // Codex's own Phase 5 security review (Build 20): `int * int`
    // multiplies in 32-bit Postgres `integer` context and overflows for
    // a real, legitimately-sized deal (e.g. $20M+ at 100% probability),
    // which would otherwise take down this whole aggregate query (and
    // therefore the pipeline board, which loads it in its own
    // `Promise.all`) until the offending deal's value was corrected.
    const rows = await withDbErrorTranslation(() =>
      tx.$queryRaw<{ currency: string; total: bigint | null }[]>(
        Prisma.sql`
          SELECT currency, SUM((value_minor_units::bigint * probability::bigint) / 100) AS total
          FROM crm_deals
          WHERE organization_id = ${organizationId}::uuid
            AND status = 'OPEN'
            AND probability IS NOT NULL
            ${pipelineFilter}
          GROUP BY currency
        `,
      ),
    );
    return rows.map((r) => ({ currency: r.currency, totalMinorUnits: Number(r.total ?? 0) }));
  },

  /** How many OPEN deals have no probability set — excluded from the weighted forecast above; surfaced so the forecast UI can say so honestly instead of silently omitting them. */
  async countOpenWithoutProbability(organizationId: string, pipelineId: string | undefined, tx: TransactionClient | typeof db = db): Promise<number> {
    return withDbErrorTranslation(() => tx.crmDeal.count({ where: { organizationId, status: "OPEN", probability: null, ...(pipelineId ? { pipelineId } : {}) } }));
  },

  /** OPEN deals with `expectedCloseDate` inside `[from, to)`, grouped by currency — for the "expected closing this window" forecast view. */
  async expectedClosingByCurrency(organizationId: string, pipelineId: string | undefined, from: Date, to: Date, tx: TransactionClient | typeof db = db): Promise<CurrencyTotal[]> {
    const grouped = await withDbErrorTranslation(() =>
      tx.crmDeal.groupBy({
        by: ["currency"],
        where: { organizationId, status: "OPEN", expectedCloseDate: { gte: from, lt: to }, ...(pipelineId ? { pipelineId } : {}) },
        _sum: { valueMinorUnits: true },
      }),
    );
    return grouped.map((g) => ({ currency: g.currency, totalMinorUnits: g._sum.valueMinorUnits ?? 0 }));
  },

  /** OPEN deals with no `expectedCloseDate` at all — excluded from the window above; surfaced the same honest way as `countOpenWithoutProbability`. */
  async countOpenWithoutExpectedCloseDate(organizationId: string, pipelineId: string | undefined, tx: TransactionClient | typeof db = db): Promise<number> {
    return withDbErrorTranslation(() => tx.crmDeal.count({ where: { organizationId, status: "OPEN", expectedCloseDate: null, ...(pipelineId ? { pipelineId } : {}) } }));
  },

  /** WON deal value with `wonAt` inside `[from, to)`, grouped by currency. */
  async wonValueByCurrency(organizationId: string, pipelineId: string | undefined, from: Date, to: Date, tx: TransactionClient | typeof db = db): Promise<CurrencyTotal[]> {
    const grouped = await withDbErrorTranslation(() =>
      tx.crmDeal.groupBy({
        by: ["currency"],
        where: { organizationId, status: "WON", wonAt: { gte: from, lt: to }, ...(pipelineId ? { pipelineId } : {}) },
        _sum: { valueMinorUnits: true },
      }),
    );
    return grouped.map((g) => ({ currency: g.currency, totalMinorUnits: g._sum.valueMinorUnits ?? 0 }));
  },
};
