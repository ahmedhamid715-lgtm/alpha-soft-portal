import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert, Target, History } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getContact } from "@/server/services/crm-contact-service";
import { getCompany } from "@/server/services/crm-company-service";
import { listLeads } from "@/server/services/crm-lead-service";
import { listActivitiesForContact } from "@/server/services/crm-activity-service";
import { toAppError } from "@/lib/errors/app-error";
import { CrmActivityList } from "@/components/crm/activity-list";
import { LogActivityForm } from "@/components/crm/log-activity-form";
import { CrmArchiveToggleButton } from "@/components/crm/archive-toggle-button";
import { archiveContactAction, reactivateContactAction } from "../../actions";

export const metadata: Metadata = { title: "CRM Contact" };

export default async function CrmContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Contact" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.read permission." />
      </div>
    );
  }

  let contact;
  try {
    contact = await getContact({ contactId: id });
  } catch (error) {
    if (toAppError(error).code === "NOT_FOUND") notFound();
    throw error;
  }

  const [company, leads, activities] = await Promise.all([
    getCompany({ companyId: contact.companyId }),
    listLeads({ primaryContactId: contact.id, limit: 25 }),
    listActivitiesForContact({ contactId: id, limit: 25 }),
  ]);

  const canManage = context.permissions.has("crm.manage");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={`${contact.firstName} ${contact.lastName}`}
        description={contact.jobTitle ?? undefined}
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Contacts", href: "/admin/crm/contacts" }, { label: `${contact.firstName} ${contact.lastName}` }]}
      />

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <StatusBadge status={contact.status === "ACTIVE" ? "success" : "neutral"}>{contact.status}</StatusBadge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Company</span>
              <Link href={`/admin/crm/companies/${company.id}`} className="hover:underline">
                {company.name}
              </Link>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Email</span>
              <span>{contact.email ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Phone</span>
              <span>{contact.phone ?? "—"}</span>
            </div>
          </CardContent>
        </Card>

        {canManage ? (
          <Card>
            <CardContent className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Archiving a contact hides it from the default list — it doesn&apos;t delete its activity history.</p>
              <CrmArchiveToggleButton input={{ contactId: contact.id }} isArchived={contact.status === "ARCHIVED"} archiveAction={archiveContactAction} reactivateAction={reactivateContactAction} />
            </CardContent>
          </Card>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Leads" description="Leads where this person is the primary contact." />
        {leads.items.length === 0 ? (
          <EmptyState icon={Target} title="No leads yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {leads.items.map((lead) => (
              <Card key={lead.id}>
                <CardContent className="flex items-center justify-between gap-4">
                  <Link href={`/admin/crm/leads/${lead.id}`} className="text-sm font-medium hover:underline">
                    {lead.title}
                  </Link>
                  <StatusBadge status={lead.status === "CONVERTED" ? "success" : lead.status === "DISQUALIFIED" ? "destructive" : "info"}>{lead.status}</StatusBadge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Activity" description="Notes, calls, emails, and meetings logged against this contact." />
        {canManage ? (
          <Card>
            <CardContent>
              <LogActivityForm parentRef={{ contactId: contact.id }} />
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
