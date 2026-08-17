import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ShieldAlert } from "lucide-react";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getAuditEventDetail } from "@/lib/audit/query";
import { AuditEventDetail } from "@/components/audit/audit-event-detail";

export const metadata: Metadata = { title: "Audit event" };

export default async function PlatformAuditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("audit.readPlatform")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Audit event" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing the platform audit log requires the audit.readPlatform permission." />
      </div>
    );
  }

  const event = await getAuditEventDetail({ id });
  // A row that belongs to a real customer organization must never render
  // here, even if the caller also happens to hold `audit.read` on that
  // specific organization (a multi-role account is possible) —
  // `getAuditEventDetail()`'s own permission check only proves the
  // caller may see THIS event, not that this event belongs on THIS
  // platform-scoped page. `/admin/audit`'s own scope is structurally
  // `organizationId IS NULL` or the platform organization itself (same
  // as `listPlatformAuditEvents()` — see audit-system.md "Platform vs.
  // organization audit"); a customer-org event id here is treated as not
  // found, not silently rendered.
  if (!event || (event.organizationId !== null && event.organizationId !== context.organizationId)) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit event"
        breadcrumbs={[{ label: "Platform audit log", href: "/admin/audit" }, { label: "Event" }]}
      />
      <AuditEventDetail event={event} basePath="/admin/audit" />
    </div>
  );
}
