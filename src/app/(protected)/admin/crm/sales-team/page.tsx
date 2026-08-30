import type { Metadata } from "next";
import { ShieldAlert, Users2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listSalesTeam } from "@/server/services/crm-sales-team-service";
import { listGoals } from "@/server/services/crm-sales-goal-service";
import { getSalesLeaderboard, getGoalAttainments, type LeaderboardMetric } from "@/server/services/crm-sales-performance-service";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { PERIOD_NAMES, type PeriodName } from "@/lib/billing/reporting/period";
import { PeriodSelector } from "@/components/crm/sales-team/period-selector";
import { LeaderboardMetricSelector } from "@/components/crm/sales-team/leaderboard-metric-selector";
import { LeaderboardTable } from "@/components/crm/sales-team/leaderboard-table";
import { RosterTable } from "@/components/crm/sales-team/roster-table";
import { AddMemberForm } from "@/components/crm/sales-team/add-member-form";
import { NewGoalForm } from "@/components/crm/sales-team/new-goal-form";
import { GoalList } from "@/components/crm/sales-team/goal-list";

export const metadata: Metadata = { title: "Sales Team" };

const LEADERBOARD_METRICS: LeaderboardMetric[] = ["REVENUE_WON", "DEALS_WON", "WIN_RATE", "CALLS_LOGGED", "APPOINTMENTS_LOGGED"];

/**
 * The sales team overview (Build 21 — Roadmap Module 15) —
 * `crm.sales_team.read`. Alpha Page Rankers' own internal sales team,
 * never a customer organization's data — see
 * docs/architecture/sales-team-management.md. Roster + leaderboard for
 * one selected period; rep-level detail/goals live on
 * `/admin/crm/sales-team/[id]`.
 */
export default async function SalesTeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.sales_team.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Sales Team" breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Sales Team" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.sales_team.read permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const period = (PERIOD_NAMES as readonly string[]).includes(single(sp.period) ?? "") ? (single(sp.period) as PeriodName) : "current_month";
  const metric = (LEADERBOARD_METRICS as readonly string[]).includes(single(sp.metric) ?? "") ? (single(sp.metric) as LeaderboardMetric) : "REVENUE_WON";

  const canManage = context.permissions.has("crm.sales_team.manage");
  const [activeMembers, leaderboard, eligibleUsers, orgWideGoals] = await Promise.all([
    listSalesTeam({ status: "ACTIVE" }),
    getSalesLeaderboard({ period, metric }),
    canManage ? listAssignableUsers() : Promise.resolve([]),
    listGoals({ salesTeamMemberId: null }),
  ]);

  const activeMemberUserIds = new Set(activeMembers.map((m) => m.userId));
  const eligibleForAdd = eligibleUsers.filter((u) => !activeMemberUserIds.has(u.id));

  const activeOrgWideGoals = orgWideGoals.filter((g) => g.status === "ACTIVE");
  const archivedOrgWideGoals = orgWideGoals.filter((g) => g.status === "ARCHIVED");
  const orgWideAttainments = await getGoalAttainments(activeOrgWideGoals.map((g) => g.id));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Sales Team"
        description="Alpha Page Rankers' own sales reps — roster, performance, targets and quotas. Never a customer organization's own data."
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Sales Team" }]}
      />

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Leaderboard"
          description="Deterministic ranking over real, closed data for the selected period — never a predicted or fabricated number."
          actions={
            <div className="flex items-center gap-2">
              <PeriodSelector basePath="/admin/crm/sales-team" period={period} />
              <LeaderboardMetricSelector basePath="/admin/crm/sales-team" metric={metric} />
            </div>
          }
        />
        {leaderboard.entries.length === 0 ? <EmptyState icon={Users2} title="No active sales team members yet" /> : <LeaderboardTable entries={leaderboard.entries} metric={metric} />}
      </section>

      {canManage ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Add a sales team member" />
          <Card className="max-w-2xl">
            <CardContent>
              <AddMemberForm eligibleUsers={eligibleForAdd} activeMembers={activeMembers} />
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <SectionHeader title="Roster" />
        {activeMembers.length === 0 ? <EmptyState icon={Users2} title="No sales team members yet" /> : <RosterTable members={activeMembers} />}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Organization-wide targets/quotas" description="Not scoped to one rep — for a per-rep goal, create it from that rep's own detail page." />
        <GoalList activeGoals={activeOrgWideGoals} attainments={orgWideAttainments} archivedGoals={archivedOrgWideGoals} canManage={canManage} />
        {canManage ? (
          <Card className="max-w-3xl">
            <CardContent>
              <NewGoalForm />
            </CardContent>
          </Card>
        ) : null}
      </section>
    </div>
  );
}
