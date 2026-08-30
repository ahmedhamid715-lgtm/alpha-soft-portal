import "server-only";
import type { CrmSalesGoal, CrmSalesGoalKind, CrmSalesGoalMetric } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface CrmSalesGoalListFilters {
  salesTeamMemberId?: string | null;
  kind?: CrmSalesGoalKind;
  metric?: CrmSalesGoalMetric;
  status?: "ACTIVE" | "ARCHIVED";
}

/**
 * Data access for `CrmSalesGoal` — RLS-protected. Goals are immutable
 * once created except `status` (`ACTIVE -> ARCHIVED`) — see the schema's
 * own comment for why (avoids the update-race class of bug entirely; a
 * mistaken goal is archived and replaced, never edited in place). The
 * database's own `EXCLUDE USING gist` constraint is the true correctness
 * guarantee against overlapping ACTIVE periods; `findOverlapping()`
 * below exists so the service layer can surface a clean `ConflictError`
 * BEFORE hitting that constraint, the same "pre-check for a good error
 * message, rely on the DB constraint as the real guarantee" pattern this
 * codebase already uses elsewhere (e.g. currency validation).
 */
export const crmSalesGoalRepository = {
  async create(
    input: {
      id: string;
      organizationId: string;
      salesTeamMemberId: string | null;
      kind: CrmSalesGoalKind;
      metric: CrmSalesGoalMetric;
      valueMinorUnits: number | null;
      currency: string | null;
      valueCount: number | null;
      valuePercent: number | null;
      periodStart: Date;
      periodEnd: Date;
      periodLabel: string;
      createdByUserId: string;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmSalesGoal> {
    return withDbErrorTranslation(() =>
      tx.crmSalesGoal.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          salesTeamMemberId: input.salesTeamMemberId,
          kind: input.kind,
          metric: input.metric,
          valueMinorUnits: input.valueMinorUnits,
          currency: input.currency,
          valueCount: input.valueCount,
          valuePercent: input.valuePercent,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          periodLabel: input.periodLabel,
          createdByUserId: input.createdByUserId,
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmSalesGoal | null> {
    return withDbErrorTranslation(() => tx.crmSalesGoal.findUnique({ where: { id } }));
  },

  /** Batched form of `findById()` — for `getGoalAttainments()`'s own batched attainment computation, one query instead of one per goal. */
  async findByIds(ids: string[], tx: TransactionClient | typeof db = db): Promise<CrmSalesGoal[]> {
    if (ids.length === 0) return [];
    return withDbErrorTranslation(() => tx.crmSalesGoal.findMany({ where: { id: { in: ids } } }));
  },

  async listForOrganization(organizationId: string, filters: CrmSalesGoalListFilters = {}, tx: TransactionClient | typeof db = db): Promise<CrmSalesGoal[]> {
    return withDbErrorTranslation(() =>
      tx.crmSalesGoal.findMany({
        where: {
          organizationId,
          ...(filters.salesTeamMemberId !== undefined ? { salesTeamMemberId: filters.salesTeamMemberId } : {}),
          ...(filters.kind ? { kind: filters.kind } : {}),
          ...(filters.metric ? { metric: filters.metric } : {}),
          ...(filters.status ? { status: filters.status } : {}),
        },
        orderBy: [{ periodStart: "desc" }],
        take: 200,
      }),
    );
  },

  /** Any ACTIVE goal for the same (organization, rep-or-team-wide, kind, metric) whose period overlaps `[periodStart, periodEnd)` — mirrors the DB's own `EXCLUDE` predicate exactly. */
  async findOverlapping(
    organizationId: string,
    salesTeamMemberId: string | null,
    kind: CrmSalesGoalKind,
    metric: CrmSalesGoalMetric,
    periodStart: Date,
    periodEnd: Date,
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmSalesGoal | null> {
    return withDbErrorTranslation(() =>
      tx.crmSalesGoal.findFirst({
        where: {
          organizationId,
          salesTeamMemberId,
          kind,
          metric,
          status: "ACTIVE",
          periodStart: { lt: periodEnd },
          periodEnd: { gt: periodStart },
        },
      }),
    );
  },

  async archive(id: string, tx: TransactionClient | typeof db = db): Promise<CrmSalesGoal> {
    return withDbErrorTranslation(() => tx.crmSalesGoal.update({ where: { id }, data: { status: "ARCHIVED" } }));
  },
};
