import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getSalesTeamMember, listSalesTeam, listDirectReports } from "@/server/services/crm-sales-team-service";
import { listGoals } from "@/server/services/crm-sales-goal-service";
import { getSalesPerformanceSummary, getGoalAttainments } from "@/server/services/crm-sales-performance-service";
import { PERIOD_NAMES, type PeriodName } from "@/lib/billing/reporting/period";
import { PeriodSelector } from "@/components/crm/sales-team/period-selector";
import { PerformanceCards } from "@/components/crm/sales-team/performance-cards";
import { GoalList } from "@/components/crm/sales-team/goal-list";
import { NewGoalForm } from "@/components/crm/sales-team/new-goal-form";
import { ManagerControl } from "@/components/crm/sales-team/manager-control";
import { RemoveMemberButton } from "@/components/crm/sales-team/remove-member-button";
import { NotFoundError } from "@/lib/errors/app-error";

export const metadata: Metadata = { title: "Sales Rep" };

/** A rep's own performance/goals detail (Build 21 — Roadmap Module 15) — `crm.sales_team.read`. */
export default async function SalesTeamMemberPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.sales_team.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Sales Rep" breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Sales Team", href: "/admin/crm/sales-team" }, { label: "Rep" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.sales_team.read permission." />
      </div>
    );
  }

  let member;
  try {
    member = await getSalesTeamMember(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const period = (PERIOD_NAMES as readonly string[]).includes(single(sp.period) ?? "") ? (single(sp.period) as PeriodName) : "current_month";

  const canManage = context.permissions.has("crm.sales_team.manage");
  const [performance, goals, directReports, allActiveMembers] = await Promise.all([
    getSalesPerformanceSummary({ period }),
    listGoals({ salesTeamMemberId: id }),
    listDirectReports(id),
    canManage ? listSalesTeam({ status: "ACTIVE" }) : Promise.resolve([]),
  ]);

  const performanceRow = performance.rows.find((r) => r.memberId === id);
  const activeGoals = goals.filter((g) => g.status === "ACTIVE");
  const archivedGoals = goals.filter((g) => g.status === "ARCHIVED");
  const attainments = await getGoalAttainments(activeGoals.map((g) => g.id));
  const candidateManagers = allActiveMembers.filter((m) => m.id !== id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={member.user.name}
        description={member.user.email}
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Sales Team", href: "/admin/crm/sales-team" }, { label: member.user.name }]}
        actions={<PeriodSelector basePath={`/admin/crm/sales-team/${id}`} period={period} />}
      />

      <div className="flex flex-wrap items-center gap-4">
        <StatusBadge status={member.status === "ACTIVE" ? "success" : "neutral"}>{member.status}</StatusBadge>
        {member.manager ? <span className="text-sm text-muted-foreground">Reports to {member.manager.user.name}</span> : null}
      </div>

      {canManage ? (
        <section className="flex flex-wrap items-end gap-6">
          <ManagerControl memberId={id} currentManagerId={member.managerId} candidateManagers={candidateManagers} />
          {member.status === "ACTIVE" ? <RemoveMemberButton memberId={id} /> : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <SectionHeader title="Performance" description="Real, closed data for the selected period — see docs/architecture/sales-team-management.md for exact attribution/formulas." />
        {performanceRow ? <PerformanceCards row={performanceRow} /> : <p className="text-sm text-muted-foreground">No performance data for this period.</p>}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Targets & quotas" />
        <GoalList activeGoals={activeGoals} attainments={attainments} archivedGoals={archivedGoals} canManage={canManage} />
        {canManage ? (
          <Card className="max-w-3xl">
            <CardContent>
              <NewGoalForm salesTeamMemberId={id} />
            </CardContent>
          </Card>
        ) : null}
      </section>

      {directReports.length > 0 ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Direct reports" />
          <div className="flex flex-col gap-2">
            {directReports.map((report) => (
              <Card key={report.id}>
                <CardContent className="flex items-center justify-between gap-4">
                  <Link href={`/admin/crm/sales-team/${report.id}`} className="font-medium hover:underline">
                    {report.user.name}
                  </Link>
                  <StatusBadge status="success">ACTIVE</StatusBadge>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
