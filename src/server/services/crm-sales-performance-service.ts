import "server-only";
import { z } from "zod";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope } from "./crm-shared";
import { crmSalesPerformanceRepository, type ActorCurrencyTotal } from "@/server/repositories/crm-sales-performance-repository";
import { crmSalesTeamMemberRepository } from "@/server/repositories/crm-sales-team-member-repository";
import { crmSalesGoalRepository } from "@/server/repositories/crm-sales-goal-repository";
import { resolvePeriod, customPeriod, PERIOD_NAMES, type FinancialPeriod, type PeriodName } from "@/lib/billing/reporting/period";
import { NotFoundError, ValidationError } from "@/lib/errors/app-error";
import type { CrmSalesGoal, CrmSalesGoalMetric } from "@/generated/prisma/client";

/**
 * Deterministic sales-team performance/leaderboard reporting (Build 21
 * — Roadmap Module 15) — `crm.sales_team.read`. Every number is real
 * SQL aggregation over Build 19/20's own authoritative data (see
 * `crm-sales-performance-repository.ts`'s own top comment for the exact
 * attribution rules); nothing here is predicted, estimated, or
 * fabricated. A ratio with a zero denominator is `null` ("not
 * measurable"), never a fake `0%` — see `docs/architecture/
 * sales-team-management.md` "Conversion rates" for the exact formulas.
 * No composite "performance score" is computed — individual metrics
 * only, per the master prompt's own explicit instruction.
 */

export interface RepPerformanceRow {
  memberId: string;
  userId: string;
  userName: string;
  wonDealCount: number;
  wonValueByCurrency: ActorCurrencyTotal[];
  lostDealCount: number;
  /** won / (won + lost) closed deals in the period — `null` if zero closed deals ("not measurable"), never a fabricated 0%. */
  winRatePercent: number | null;
  callsLogged: number;
  appointmentsLogged: number;
  leadConversion: { createdCount: number; convertedCount: number; ratePercent: number | null };
  openPipelineValueByCurrency: ActorCurrencyTotal[];
  weightedPipelineByCurrency: ActorCurrencyTotal[];
}

export interface SalesPerformanceSummary {
  period: FinancialPeriod;
  rows: RepPerformanceRow[];
}

function pickCurrencyTotals(rows: ActorCurrencyTotal[], actorUserId: string): ActorCurrencyTotal[] {
  return rows.filter((r) => r.actorUserId === actorUserId);
}

const periodInputSchema = z.union([z.object({ period: z.enum(PERIOD_NAMES) }), z.object({ periodStart: z.coerce.date(), periodEnd: z.coerce.date() })]);

function resolveRequestedPeriod(input: z.infer<typeof periodInputSchema>): FinancialPeriod {
  if ("period" in input) return resolvePeriod(input.period as PeriodName, "UTC", new Date());
  return customPeriod(input.periodStart, input.periodEnd, "UTC");
}

/** Performance for every currently-ACTIVE sales team member, for one period — one pass of grouped aggregate queries, never one query per rep. */
export async function getSalesPerformanceSummary(rawInput: unknown = {}): Promise<SalesPerformanceSummary> {
  const input = parseOrThrowPeriod(rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.sales_team.read");
  const period = resolveRequestedPeriod(input);

  return withTenantContext(tenantScope, async (tx) => {
    const members = await crmSalesTeamMemberRepository.listForOrganization(organizationId, { status: "ACTIVE" }, tx);

    const [won, lost, calls, appointments, leadConversion, openPipeline, weightedPipeline] = await Promise.all([
      crmSalesPerformanceRepository.closedDealsByActor(organizationId, "WON", period.start, period.end, tx),
      crmSalesPerformanceRepository.closedDealsByActor(organizationId, "LOST", period.start, period.end, tx),
      crmSalesPerformanceRepository.activityCountsByActor(organizationId, "CALL", period.start, period.end, tx),
      crmSalesPerformanceRepository.activityCountsByActor(organizationId, "MEETING", period.start, period.end, tx),
      crmSalesPerformanceRepository.leadCohortConversionByAssignee(organizationId, period.start, period.end, tx),
      crmSalesPerformanceRepository.openPipelineValueByActor(organizationId, tx),
      crmSalesPerformanceRepository.weightedPipelineByActor(organizationId, tx),
    ]);

    const rows: RepPerformanceRow[] = members.map((member) => {
      const wonForActor = won.filter((w) => w.actorUserId === member.userId);
      const lostForActor = lost.filter((w) => w.actorUserId === member.userId);
      const wonDealCount = wonForActor.reduce((sum, w) => sum + w.dealCount, 0);
      const lostDealCount = lostForActor.reduce((sum, w) => sum + w.dealCount, 0);
      const closedCount = wonDealCount + lostDealCount;
      const callRow = calls.find((c) => c.actorUserId === member.userId);
      const apptRow = appointments.find((c) => c.actorUserId === member.userId);
      const conversionRow = leadConversion.find((c) => c.actorUserId === member.userId);

      return {
        memberId: member.id,
        userId: member.userId,
        userName: member.user.name,
        wonDealCount,
        wonValueByCurrency: wonForActor.map((w) => ({ actorUserId: w.actorUserId, currency: w.currency, totalMinorUnits: w.totalMinorUnits })),
        lostDealCount,
        winRatePercent: closedCount > 0 ? Math.round((wonDealCount / closedCount) * 100) : null,
        callsLogged: callRow?.count ?? 0,
        appointmentsLogged: apptRow?.count ?? 0,
        leadConversion: {
          createdCount: conversionRow?.createdCount ?? 0,
          convertedCount: conversionRow?.convertedCount ?? 0,
          ratePercent: conversionRow && conversionRow.createdCount > 0 ? Math.round((conversionRow.convertedCount / conversionRow.createdCount) * 100) : null,
        },
        openPipelineValueByCurrency: pickCurrencyTotals(openPipeline, member.userId),
        weightedPipelineByCurrency: pickCurrencyTotals(weightedPipeline, member.userId),
      };
    });

    return { period, rows };
  });
}

function parseOrThrowPeriod(rawInput: unknown): z.infer<typeof periodInputSchema> {
  const result = periodInputSchema.safeParse(rawInput);
  if (!result.success) throw new ValidationError("Provide either `period` or both `periodStart`/`periodEnd`.");
  return result.data;
}

export type LeaderboardMetric = "REVENUE_WON" | "DEALS_WON" | "WIN_RATE" | "CALLS_LOGGED" | "APPOINTMENTS_LOGGED";

export interface LeaderboardEntry {
  rank: number;
  row: RepPerformanceRow;
  /** The single sort value used for ranking — `null` sorts last (never treated as zero). */
  sortValue: number | null;
}

/**
 * Deterministic ranking over `getSalesPerformanceSummary()`'s own rows.
 * `REVENUE_WON` sorts by the single largest currency total for that rep
 * (a genuine, disclosed simplification — see the architecture doc's own
 * "Leaderboards" section for why a multi-currency rep's own smaller
 * currency totals aren't blended into one number). Ties break
 * deterministically by `userName` ascending, never arbitrary DB order.
 */
export async function getSalesLeaderboard(rawInput: unknown = {}): Promise<{ period: FinancialPeriod; metric: LeaderboardMetric; entries: LeaderboardEntry[] }> {
  const leaderboardInputSchema = periodInputSchema.and(z.object({ metric: z.enum(["REVENUE_WON", "DEALS_WON", "WIN_RATE", "CALLS_LOGGED", "APPOINTMENTS_LOGGED"]).default("REVENUE_WON") }));
  const parsed = leaderboardInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError("Invalid leaderboard request.");
  const { metric, ...periodInput } = parsed.data;

  const summary = await getSalesPerformanceSummary(periodInput);

  function sortValueFor(row: RepPerformanceRow): number | null {
    switch (metric) {
      case "REVENUE_WON":
        return row.wonValueByCurrency.length > 0 ? Math.max(...row.wonValueByCurrency.map((c) => c.totalMinorUnits)) : null;
      case "DEALS_WON":
        return row.wonDealCount;
      case "WIN_RATE":
        return row.winRatePercent;
      case "CALLS_LOGGED":
        return row.callsLogged;
      case "APPOINTMENTS_LOGGED":
        return row.appointmentsLogged;
    }
  }

  const withValues = summary.rows.map((row) => ({ row, sortValue: sortValueFor(row) }));
  withValues.sort((a, b) => {
    if (a.sortValue === null && b.sortValue === null) return a.row.userName.localeCompare(b.row.userName);
    if (a.sortValue === null) return 1;
    if (b.sortValue === null) return -1;
    if (a.sortValue !== b.sortValue) return b.sortValue - a.sortValue;
    return a.row.userName.localeCompare(b.row.userName);
  });

  const entries: LeaderboardEntry[] = withValues.map((v, index) => ({ rank: index + 1, row: v.row, sortValue: v.sortValue }));
  return { period: summary.period, metric, entries };
}

export interface GoalAttainment {
  goal: CrmSalesGoal;
  actual: number;
  actualCurrency: string | null;
  target: number;
  /** `null` when the goal's own target denominator is zero (never divides by zero) — e.g. a 0-value goal, which validation already prevents for count/percent metrics but is defensively handled here too. */
  attainmentPercent: number | null;
}

/**
 * Batched form of goal attainment — one auth resolution, one tenant
 * transaction, and at most one aggregate query PER DISTINCT
 * (metric, period) group among the given goals, rather than the
 * straight-line "one full attainment computation per goal" a page
 * rendering several goals would otherwise need. Found by Build 21's own
 * Phase 8 (read-only) performance review: both the overview page's own
 * organization-wide goal list and a rep's own detail page previously
 * called single-goal `getGoalAttainment()` once per active goal in a
 * `Promise.all()`, which doesn't reduce query count — it's a genuine
 * N+1 (~18-19 SQL statements per goal, dominated by the same
 * authorization/tenant-context fan-out every service call pays).
 * Goals sharing the same metric and exact period window (the common
 * case — most goals use a named period like "current_month") share the
 * SAME underlying aggregate call; goals with different metrics/periods
 * still each get their own aggregate, but only once per distinct group,
 * never once per goal.
 */
export async function getGoalAttainments(goalIds: string[]): Promise<Map<string, GoalAttainment>> {
  const { tenantScope, organizationId } = await resolveCrmScope("crm.sales_team.read");
  if (goalIds.length === 0) return new Map();

  return withTenantContext(tenantScope, async (tx) => {
    const goals = (await crmSalesGoalRepository.findByIds(goalIds, tx)).filter((g) => g.organizationId === organizationId);
    const memberIds = [...new Set(goals.map((g) => g.salesTeamMemberId).filter((id): id is string => id !== null))];
    const members = await crmSalesTeamMemberRepository.findByIds(memberIds, tx);
    const memberById = new Map(members.map((m) => [m.id, m]));

    const groupKey = (g: CrmSalesGoal) => `${g.metric}|${g.periodStart.getTime()}|${g.periodEnd.getTime()}`;
    const groups = new Map<string, CrmSalesGoal[]>();
    for (const goal of goals) groups.set(groupKey(goal), [...(groups.get(groupKey(goal)) ?? []), goal]);

    const results = new Map<string, GoalAttainment>();

    for (const groupGoals of groups.values()) {
      const { metric, periodStart, periodEnd }: { metric: CrmSalesGoalMetric; periodStart: Date; periodEnd: Date } = groupGoals[0];

      const wonRows = metric === "REVENUE_WON" || metric === "DEALS_WON" ? await crmSalesPerformanceRepository.closedDealsByActor(organizationId, "WON", periodStart, periodEnd, tx) : null;
      const countRows =
        metric === "CALLS_LOGGED" || metric === "APPOINTMENTS_LOGGED"
          ? await crmSalesPerformanceRepository.activityCountsByActor(organizationId, metric === "CALLS_LOGGED" ? "CALL" : "MEETING", periodStart, periodEnd, tx)
          : null;
      const conversionRows = metric === "LEAD_CONVERSION_RATE" ? await crmSalesPerformanceRepository.leadCohortConversionByAssignee(organizationId, periodStart, periodEnd, tx) : null;

      for (const goal of groupGoals) {
        const member = goal.salesTeamMemberId ? (memberById.get(goal.salesTeamMemberId) ?? null) : null;
        let actual = 0;
        let actualCurrency: string | null = null;
        let target = 0;

        if (goal.metric === "REVENUE_WON") {
          const relevant = member ? wonRows!.filter((w) => w.actorUserId === member.userId && w.currency === goal.currency) : wonRows!.filter((w) => w.currency === goal.currency);
          actual = relevant.reduce((sum, w) => sum + w.totalMinorUnits, 0);
          actualCurrency = goal.currency;
          target = goal.valueMinorUnits ?? 0;
        } else if (goal.metric === "DEALS_WON") {
          const relevant = member ? wonRows!.filter((w) => w.actorUserId === member.userId) : wonRows!;
          actual = relevant.reduce((sum, w) => sum + w.dealCount, 0);
          target = goal.valueCount ?? 0;
        } else if (goal.metric === "CALLS_LOGGED" || goal.metric === "APPOINTMENTS_LOGGED") {
          const relevant = member ? countRows!.filter((c) => c.actorUserId === member.userId) : countRows!;
          actual = relevant.reduce((sum, c) => sum + c.count, 0);
          target = goal.valueCount ?? 0;
        } else if (goal.metric === "LEAD_CONVERSION_RATE") {
          const relevant = member ? conversionRows!.filter((c) => c.actorUserId === member.userId) : conversionRows!;
          const created = relevant.reduce((sum, c) => sum + c.createdCount, 0);
          const converted = relevant.reduce((sum, c) => sum + c.convertedCount, 0);
          actual = created > 0 ? Math.round((converted / created) * 100) : 0;
          target = goal.valuePercent ?? 0;
        }

        results.set(goal.id, { goal, actual, actualCurrency, target, attainmentPercent: target > 0 ? Math.round((actual / target) * 100) : null });
      }
    }

    return results;
  });
}

/** Actual-vs-target for one specific goal, computed over THAT goal's own stored period — not the caller's arbitrary period, since a goal's attainment is only meaningful against its own window. A thin wrapper over `getGoalAttainments()` — see that function's own comment for why a page rendering SEVERAL goals should call it directly instead of this one in a loop. */
export async function getGoalAttainment(goalId: string): Promise<GoalAttainment> {
  const attainments = await getGoalAttainments([goalId]);
  const attainment = attainments.get(goalId);
  // `getGoalAttainments()` silently drops a nonexistent or cross-
  // organization goal id rather than throwing — appropriate for a
  // caller passing many ids at once, but this single-goal wrapper
  // restores the "not found" contract every other Sales Team lookup
  // has.
  if (!attainment) throw new NotFoundError("Sales goal");
  return attainment;
}
