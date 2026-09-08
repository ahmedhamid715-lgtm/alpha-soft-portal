import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert, Users, Target, History } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getCompany } from "@/server/services/crm-company-service";
import { listContactsForCompany } from "@/server/services/crm-contact-service";
import { listLeads } from "@/server/services/crm-lead-service";
import { listActivitiesForCompany } from "@/server/services/crm-activity-service";
import { toAppError } from "@/lib/errors/app-error";
import { CrmActivityList } from "@/components/crm/activity-list";
import { LogActivityForm } from "@/components/crm/log-activity-form";
import { CrmArchiveToggleButton } from "@/components/crm/archive-toggle-button";
import { NewContactForm } from "./new-contact-form";
import { archiveCompanyAction as archiveAction, reactivateCompanyAction as reactivateAction } from "../../actions";

export const metadata: Metadata = { title: "CRM Company" };

/**
 * A single `CrmCompany`'s detail view — `crm.read` to view, `crm.manage`
 * to log activity/add a contact/archive. Composes contacts, leads, and
 * the activity timeline for this ONE company, same "one page, several
 * read-only panels" shape `admin/users/[id]/page.tsx` already
 * establishes for `User`.
 */
export default async function CrmCompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Company" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.read permission." />
      </div>
    );
  }

  let company;
  try {
    company = await getCompany({ companyId: id });
  } catch (error) {
    if (toAppError(error).code === "NOT_FOUND") notFound();
    throw error;
  }

  const [contacts, leads, activities] = await Promise.all([
    listContactsForCompany({ companyId: id }),
    listLeads({ companyId: id, limit: 25 }),
    listActivitiesForCompany({ companyId: id, limit: 25 }),
  ]);

  const canManage = context.permissions.has("crm.manage");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={company.name}
        description={company.domain ?? undefined}
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Companies", href: "/admin/crm/companies" }, { label: company.name }]}
        actions={
          <Link href={`/admin/crm/customers/${company.id}`} className="text-sm font-medium text-link hover:underline">
            View Customer 360 →
          </Link>
        }
      />

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <StatusBadge status={company.status === "ACTIVE" ? "success" : "neutral"}>{company.status}</StatusBadge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Industry</span>
              <span>{company.industry ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Website</span>
              <span>{company.website ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Phone</span>
              <span>{company.phone ?? "—"}</span>
            </div>
          </CardContent>
        </Card>

        {canManage ? (
          <Card>
            <CardContent className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Archiving a company hides it from the default list — it doesn&apos;t delete its contacts, leads, or activity history.</p>
              <CrmArchiveToggleButton input={{ companyId: company.id }} isArchived={company.status === "ARCHIVED"} archiveAction={archiveAction} reactivateAction={reactivateAction} />
            </CardContent>
          </Card>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Contacts" description="People at this company." />
        {canManage ? (
          <Card className="max-w-2xl">
            <CardContent>
              <NewContactForm companyId={company.id} />
            </CardContent>
          </Card>
        ) : null}
        {contacts.length === 0 ? (
          <EmptyState icon={Users} title="No contacts yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {contacts.map((contact) => (
              <Card key={contact.id}>
                <CardContent className="flex items-center justify-between gap-4">
                  <Link href={`/admin/crm/contacts/${contact.id}`} className="flex flex-col hover:underline">
                    <span className="text-sm font-medium">
                      {contact.firstName} {contact.lastName}
                    </span>
                    <span className="text-xs text-muted-foreground">{contact.jobTitle ?? contact.email ?? "—"}</span>
                  </Link>
                  <StatusBadge status={contact.status === "ACTIVE" ? "success" : "neutral"}>{contact.status}</StatusBadge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Leads" description="Leads tied to this company." />
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
        <SectionHeader title="Activity" description="Notes, calls, emails, and meetings logged against this company." />
        {canManage ? (
          <Card>
            <CardContent>
              <LogActivityForm parentRef={{ companyId: company.id }} />
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
