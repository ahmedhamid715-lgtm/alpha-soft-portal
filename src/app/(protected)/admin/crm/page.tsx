import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, Building2, Users, Target, ListChecks, ArrowRight, Handshake, Trophy } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listCompanies } from "@/server/services/crm-company-service";
import { listContacts } from "@/server/services/crm-contact-service";
import { listLeads } from "@/server/services/crm-lead-service";
import { listTasks } from "@/server/services/crm-task-service";
import { listDeals } from "@/server/services/crm-deal-service";
import { listSalesTeam } from "@/server/services/crm-sales-team-service";
import { formatInTimeZone } from "@/lib/utils/datetime";
import type { CrmLeadStatus } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "CRM" };

const LEAD_STATUSES: CrmLeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "DISQUALIFIED"];

/**
 * The CRM landing page (Build 19 / Roadmap 13) — `crm.read`. Alpha Page
 * Rankers' own internal sales pipeline, never a customer organization's
 * data — see docs/architecture/crm-architecture.md. Composes cheap
 * `totalCount`-only queries (limit: 1) rather than a dedicated
 * aggregate/summary service — CRM's own dataset is one platform
 * organization's worth of sales data, not the ever-growing
 * platform-wide scale `knowledge-observability-service.ts`'s dedicated
 * aggregate query was built to avoid re-querying for.
 */
export default async function CrmDashboardPage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="CRM" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.read permission." />
      </div>
    );
  }

  const canSeePipeline = context.permissions.has("crm.pipeline.read");
  const canSeeSalesTeam = context.permissions.has("crm.sales_team.read");
  const [companies, contacts, leadCounts, myOpenTasks, openDeals, salesTeamCount] = await Promise.all([
    listCompanies({ limit: 1, status: "ACTIVE" }),
    listContacts({ limit: 1, status: "ACTIVE" }),
    Promise.all(LEAD_STATUSES.map((status) => listLeads({ limit: 1, status }).then((r) => [status, r.pageInfo.totalCount ?? 0] as const))),
    listTasks({ limit: 10, status: "OPEN", assignedToUserId: context.user!.id }),
    canSeePipeline ? listDeals({ limit: 1, status: "OPEN" }) : null,
    canSeeSalesTeam ? listSalesTeam({ status: "ACTIVE" }) : null,
  ]);

  const openLeadCount = leadCounts.filter(([status]) => status !== "CONVERTED" && status !== "DISQUALIFIED").reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="CRM" description="Alpha Page Rankers' own sales pipeline — companies, contacts, leads, and follow-ups. Never a customer organization's own data." />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent>
            <Link href="/admin/crm/companies" className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Building2 className="size-4" aria-hidden="true" /> Active companies
              </span>
              <span className="text-2xl font-semibold tabular-nums">{companies.pageInfo.totalCount}</span>
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Link href="/admin/crm/contacts" className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="size-4" aria-hidden="true" /> Active contacts
              </span>
              <span className="text-2xl font-semibold tabular-nums">{contacts.pageInfo.totalCount}</span>
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Link href="/admin/crm/leads" className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Target className="size-4" aria-hidden="true" /> Open leads
              </span>
              <span className="text-2xl font-semibold tabular-nums">{openLeadCount}</span>
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Link href="/admin/crm/tasks" className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <ListChecks className="size-4" aria-hidden="true" /> My open tasks
              </span>
              <span className="text-2xl font-semibold tabular-nums">{myOpenTasks.pageInfo.totalCount}</span>
            </Link>
          </CardContent>
        </Card>
        {canSeePipeline ? (
          <Card>
            <CardContent>
              <Link href="/admin/crm/pipeline" className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Handshake className="size-4" aria-hidden="true" /> Open deals
                </span>
                <span className="text-2xl font-semibold tabular-nums">{openDeals?.pageInfo.totalCount ?? 0}</span>
              </Link>
            </CardContent>
          </Card>
        ) : null}
        {canSeeSalesTeam ? (
          <Card>
            <CardContent>
              <Link href="/admin/crm/sales-team" className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Trophy className="size-4" aria-hidden="true" /> Sales team
                </span>
                <span className="text-2xl font-semibold tabular-nums">{salesTeamCount?.length ?? 0}</span>
              </Link>
            </CardContent>
          </Card>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        {/* "Lead pipeline" — distinct from the real Sales Pipeline board
            (`/admin/crm/pipeline`, Build 20); this section is purely
            lead-status counts, unrelated to `CrmPipeline`/`CrmDeal`. */}
        <SectionHeader
          title="Lead pipeline"
          description="Leads by status."
          actions={
            canSeePipeline ? (
              <Link href="/admin/crm/pipeline" className="flex items-center gap-1 text-sm text-muted-foreground hover:underline">
                Sales pipeline <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            ) : undefined
          }
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {leadCounts.map(([status, count]) => (
            <Card key={status}>
              <CardContent className="flex flex-col gap-1">
                <StatusBadge status={leadStatusVariant(status)}>{status}</StatusBadge>
                <span className="text-lg font-semibold tabular-nums">{count}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="My open tasks" description="Follow-ups assigned to you." actions={<Link href="/admin/crm/tasks" className="flex items-center gap-1 text-sm text-muted-foreground hover:underline">All tasks <ArrowRight className="size-3.5" aria-hidden="true" /></Link>} />
        {myOpenTasks.items.length === 0 ? (
          <EmptyState icon={ListChecks} title="No open tasks assigned to you" />
        ) : (
          <div className="flex flex-col gap-2">
            {myOpenTasks.items.map((task) => (
              <Card key={task.id}>
                <CardContent className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium">{task.title}</span>
                  <span className="text-xs text-muted-foreground">{task.dueAt ? `Due ${formatInTimeZone(task.dueAt, "UTC")}` : "No due date"}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function leadStatusVariant(status: CrmLeadStatus): "neutral" | "info" | "warning" | "success" | "destructive" | "primary" {
  switch (status) {
    case "NEW":
      return "info";
    case "CONTACTED":
      return "warning";
    case "QUALIFIED":
      return "primary";
    case "CONVERTED":
      return "success";
    case "DISQUALIFIED":
      return "destructive";
    default:
      return "neutral";
  }
}
