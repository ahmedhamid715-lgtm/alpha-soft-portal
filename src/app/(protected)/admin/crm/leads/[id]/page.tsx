import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert, History } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getLead } from "@/server/services/crm-lead-service";
import { getCompany } from "@/server/services/crm-company-service";
import { getContact } from "@/server/services/crm-contact-service";
import { listActivitiesForLead } from "@/server/services/crm-activity-service";
import { listTasks } from "@/server/services/crm-task-service";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { toAppError } from "@/lib/errors/app-error";
import { CrmActivityList } from "@/components/crm/activity-list";
import { LogActivityForm } from "@/components/crm/log-activity-form";
import { LeadStatusForm } from "@/components/crm/lead-status-form";
import { NewTaskForm } from "@/components/crm/new-task-form";
import { CrmTaskList } from "@/components/crm/task-list";
import type { CrmLeadStatus } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "CRM Lead" };

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

export default async function CrmLeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Lead" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.read permission." />
      </div>
    );
  }

  let lead;
  try {
    lead = await getLead({ leadId: id });
  } catch (error) {
    if (toAppError(error).code === "NOT_FOUND") notFound();
    throw error;
  }

  const canManage = context.permissions.has("crm.manage");
  const [company, primaryContact, activities, tasks, users] = await Promise.all([
    getCompany({ companyId: lead.companyId }),
    lead.primaryContactId ? getContact({ contactId: lead.primaryContactId }) : Promise.resolve(null),
    listActivitiesForLead({ leadId: id, limit: 25 }),
    listTasks({ leadId: id, limit: 50 }),
    listAssignableUsers(),
  ]);
  const assignedUser = lead.assignedToUserId ? (users.find((u) => u.id === lead.assignedToUserId) ?? null) : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={lead.title}
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Leads", href: "/admin/crm/leads" }, { label: lead.title }]}
        actions={<StatusBadge status={leadStatusVariant(lead.status)}>{lead.status}</StatusBadge>}
      />

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Company</span>
              <Link href={`/admin/crm/companies/${company.id}`} className="hover:underline">
                {company.name}
              </Link>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Primary contact</span>
              {primaryContact ? (
                <Link href={`/admin/crm/contacts/${primaryContact.id}`} className="hover:underline">
                  {primaryContact.firstName} {primaryContact.lastName}
                </Link>
              ) : (
                <span>—</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Assigned to</span>
              <span>{assignedUser ? assignedUser.name : lead.assignedToUserId ? "Former platform staff" : "Unassigned"}</span>
            </div>
            {lead.description ? (
              <div className="flex flex-col gap-1 pt-2">
                <span className="text-muted-foreground">Description</span>
                <p className="text-foreground">{lead.description}</p>
              </div>
            ) : null}
            {lead.status === "DISQUALIFIED" && lead.disqualifiedReason ? (
              <div className="flex flex-col gap-1 pt-2">
                <span className="text-muted-foreground">Disqualified reason</span>
                <p className="text-foreground">{lead.disqualifiedReason}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {canManage ? (
          <Card>
            <CardContent className="flex flex-col gap-3">
              <span className="text-sm text-muted-foreground">Advance this lead through the pipeline.</span>
              <LeadStatusForm leadId={lead.id} currentStatus={lead.status} />
            </CardContent>
          </Card>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Tasks" description="Follow-ups scoped to this lead." />
        {canManage ? <NewTaskForm parentRef={{ leadId: lead.id }} users={users} /> : null}
        <CrmTaskList tasks={tasks.items} canManage={canManage} />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Activity" description="Notes, calls, emails, meetings, and status changes logged against this lead." />
        {canManage ? (
          <Card>
            <CardContent>
              <LogActivityForm parentRef={{ leadId: lead.id }} />
            </CardContent>
          </Card>
        ) : null}
        <CrmActivityList activities={activities.items} />
        {activities.items.length === 0 ? null : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <History className="size-3.5" aria-hidden="true" /> Showing the most recent {activities.items.length} of {activities.pageInfo.totalCount} activities.
          </p>
        )}
      </section>
    </div>
  );
}
