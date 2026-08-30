import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface ActorCurrencyTotal {
  actorUserId: string;
  currency: string;
  totalMinorUnits: number;
}

export interface ActorCount {
  actorUserId: string;
  count: number;
}

/**
 * Cross-cutting performance/attribution aggregation over EXISTING Build
 * 19/20 tables (`crm_deals`, `crm_deal_history`, `crm_activities`,
 * `crm_leads`) — no new business data is stored here, only read. Every
 * aggregate runs as a real SQL SUM/COUNT/GROUP BY, never a full row list
 * pulled into JavaScript (the same discipline `crmDealRepository`'s own
 * forecast methods already establish).
 *
 * ATTRIBUTION (see docs/architecture/sales-team-management.md "Historical
 * attribution" for the full reasoning): won/lost deal credit uses
 * `crm_deal_history`'s own immutable `actor_user_id` on the WON/LOST
 * entry — who actually performed the close — NEVER `crm_deals.assigned_
 * to_user_id` (mutable; a later reassignment must not silently rewrite
 * a closed period's own numbers). Call/appointment credit uses
 * `crm_activities.actor_user_id`, also immutable. Deal VALUE/CURRENCY
 * still comes from the deal's own current `value_minor_units`/`currency`
 * (Build 20 itself has no historical value snapshot to attribute from
 * either — `wonValueByCurrency()`'s own forecast query already relies on
 * the same current-value convention; this file stays consistent with it
 * rather than inventing a stricter guarantee Build 20 doesn't have).
 */
export const crmSalesPerformanceRepository = {
  /** Deal value/count attributed to whoever closed it (WON or LOST), by the immutable history-entry actor, grouped by currency. */
  async closedDealsByActor(
    organizationId: string,
    outcome: "WON" | "LOST",
    from: Date,
    to: Date,
    tx: TransactionClient | typeof db = db,
  ): Promise<{ actorUserId: string; currency: string; dealCount: number; totalMinorUnits: number }[]> {
    const rows = await withDbErrorTranslation(() =>
      tx.$queryRaw<{ actor_user_id: string; currency: string; deal_count: bigint; total: bigint | null }[]>(
        Prisma.sql`
          SELECT h.actor_user_id, d.currency, COUNT(*)::bigint AS deal_count, SUM(d.value_minor_units)::bigint AS total
          FROM crm_deal_history h
          JOIN crm_deals d ON d.id = h.deal_id
          WHERE h.organization_id = ${organizationId}::uuid
            AND h.type = ${outcome}
            AND h.occurred_at >= ${from}
            AND h.occurred_at < ${to}
          GROUP BY h.actor_user_id, d.currency
        `,
      ),
    );
    return rows.map((r) => ({ actorUserId: r.actor_user_id, currency: r.currency, dealCount: Number(r.deal_count), totalMinorUnits: Number(r.total ?? 0) }));
  },

  /** Count of `type`-typed CRM activities (CALL/MEETING) logged in the window, by the immutable actor. */
  async activityCountsByActor(organizationId: string, type: "CALL" | "MEETING", from: Date, to: Date, tx: TransactionClient | typeof db = db): Promise<ActorCount[]> {
    const grouped = await withDbErrorTranslation(() =>
      tx.crmActivity.groupBy({ by: ["actorUserId"], where: { organizationId, type, occurredAt: { gte: from, lt: to } }, _count: { _all: true } }),
    );
    return grouped.map((g) => ({ actorUserId: g.actorUserId, count: g._count._all }));
  },

  /**
   * Cohort lead-conversion counts for leads ASSIGNED (current, live
   * assignment — see the architecture doc's own documented simplification
   * for why this one attribution stays live, not actor-based) with
   * `createdAt` inside `[from, to)`: how many of THOSE leads have (as of
   * now) reached CONVERTED, regardless of when the conversion itself
   * happened. An intentionally as-of-now cohort measure, not a
   * same-period-conversion measure — see the architecture doc for why.
   */
  async leadCohortConversionByAssignee(organizationId: string, from: Date, to: Date, tx: TransactionClient | typeof db = db): Promise<{ actorUserId: string; createdCount: number; convertedCount: number }[]> {
    const rows = await withDbErrorTranslation(() =>
      tx.$queryRaw<{ assigned_to_user_id: string; created_count: bigint; converted_count: bigint }[]>(
        Prisma.sql`
          SELECT assigned_to_user_id,
                 COUNT(*)::bigint AS created_count,
                 COUNT(*) FILTER (WHERE status = 'CONVERTED')::bigint AS converted_count
          FROM crm_leads
          WHERE organization_id = ${organizationId}::uuid
            AND assigned_to_user_id IS NOT NULL
            AND created_at >= ${from}
            AND created_at < ${to}
          GROUP BY assigned_to_user_id
        `,
      ),
    );
    return rows.map((r) => ({ actorUserId: r.assigned_to_user_id, createdCount: Number(r.created_count), convertedCount: Number(r.converted_count) }));
  },

  /** Current OPEN pipeline value attributed to whoever currently owns the deal — deliberately LIVE (current `assigned_to_user_id`), matching Build 20's own forecast semantics: an open deal's own numbers are supposed to move with reassignment, unlike a closed deal's own history. */
  async openPipelineValueByActor(organizationId: string, tx: TransactionClient | typeof db = db): Promise<ActorCurrencyTotal[]> {
    const grouped = await withDbErrorTranslation(() =>
      tx.crmDeal.groupBy({ by: ["assignedToUserId", "currency"], where: { organizationId, status: "OPEN", assignedToUserId: { not: null } }, _sum: { valueMinorUnits: true } }),
    );
    return grouped.map((g) => ({ actorUserId: g.assignedToUserId!, currency: g.currency, totalMinorUnits: g._sum.valueMinorUnits ?? 0 }));
  },

  /** Weighted (value × probability / 100) OPEN pipeline by current owner — see `crmDealRepository.weightedForecastByCurrency()`'s own comment for the `::bigint` overflow reasoning this mirrors exactly. */
  async weightedPipelineByActor(organizationId: string, tx: TransactionClient | typeof db = db): Promise<ActorCurrencyTotal[]> {
    const rows = await withDbErrorTranslation(() =>
      tx.$queryRaw<{ assigned_to_user_id: string; currency: string; total: bigint | null }[]>(
        Prisma.sql`
          SELECT assigned_to_user_id, currency, SUM((value_minor_units::bigint * probability::bigint) / 100) AS total
          FROM crm_deals
          WHERE organization_id = ${organizationId}::uuid
            AND status = 'OPEN'
            AND probability IS NOT NULL
            AND assigned_to_user_id IS NOT NULL
          GROUP BY assigned_to_user_id, currency
        `,
      ),
    );
    return rows.map((r) => ({ actorUserId: r.assigned_to_user_id, currency: r.currency, totalMinorUnits: Number(r.total ?? 0) }));
  },
};
