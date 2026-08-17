import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ShieldAlert } from "lucide-react";
import { resolveOrganizationContext } from "@/lib/authorization/context";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { getAuditEventDetail } from "@/lib/audit/query";
import { AuditEventDetail } from "@/components/audit/audit-event-detail";

export const metadata: Metadata = { title: "Audit event" };

export default async function OrganizationAuditEventPage({ params }: { params: Promise<{ id: string; eventId: string }> }) {
  const { id, eventId } = await params;
  const context = await resolveOrganizationContext(id);

  if (!context.organizationId || context.organizationId !== id) {
    notFound();
  }
  if (!context.permissions.has("audit.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Audit event" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing this organization's audit log requires the audit.read permission." />
      </div>
    );
  }

  const organization = await organizationRepository.findById(id);
  if (!organization) notFound();

  // `getAuditEventDetail()` re-checks the organization boundary itself
  // (never trust that "the list only showed authorized rows" implies
  // this fetch is safe too — see query.ts) — an event id that belongs to
  // a DIFFERENT organization than `id` in the URL is treated as not
  // found here, the same IDOR-safe pattern every other Module 07 detail
  // page in this app uses.
  const event = await getAuditEventDetail({ id: eventId, organizationId: id });
  if (!event || event.organizationId !== id) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit event"
        description={organization.displayName}
        breadcrumbs={[
          { label: "Organizations", href: "/organizations" },
          { label: organization.displayName, href: `/organizations/${id}` },
          { label: "Audit log", href: `/organizations/${id}/audit` },
          { label: "Event" },
        ]}
      />
      <AuditEventDetail event={event} basePath={`/organizations/${id}/audit`} />
    </div>
  );
}
