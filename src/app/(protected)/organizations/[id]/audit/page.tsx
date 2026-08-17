import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert, Download } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { resolveOrganizationContext } from "@/lib/authorization/context";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { listOrganizationAuditEvents } from "@/lib/audit/query";
import { AuditFiltersForm } from "@/components/audit/audit-filters-form";
import { AuditLogTable, AuditLogPaginationControls } from "@/components/audit/audit-log-table";

export const metadata: Metadata = { title: "Audit log" };

/**
 * This organization's own audit trail (Phase 16) — `audit.read`,
 * organization-scoped. Reachable at `/organizations/{id}/audit`, linked
 * from the organization overview page's "Manage" grid, the same pattern
 * every other org-scoped screen (members/invitations/settings) already
 * follows. Never shows another organization's events, and never shows
 * platform-wide events — see `audit-system.md` "Platform vs.
 * organization audit."
 */
export default async function OrganizationAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const context = await resolveOrganizationContext(id);

  if (!context.organizationId || context.organizationId !== id) {
    notFound();
  }

  if (!context.permissions.has("audit.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Audit log" breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Audit log" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing this organization's audit log requires the audit.read permission." />
      </div>
    );
  }

  const organization = await organizationRepository.findById(id);
  if (!organization) notFound();

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const query = {
    organizationId: id,
    cursor: single(sp.cursor),
    search: single(sp.search),
    category: single(sp.category),
    outcome: single(sp.outcome),
    createdAfter: single(sp.createdAfter),
    createdBefore: single(sp.createdBefore),
    actorUserId: single(sp.actorUserId),
    resourceType: single(sp.resourceType),
    resourceId: single(sp.resourceId),
    requestId: single(sp.requestId),
    correlationId: single(sp.correlationId),
  };

  const page = await listOrganizationAuditEvents(query);

  const basePath = `/organizations/${id}/audit`;
  const filterParams = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (key === "cursor") continue;
    const v = single(value);
    if (v) filterParams.set(key, v);
  }
  const nextParams = new URLSearchParams(filterParams);
  if (page.pageInfo.nextCursor) nextParams.set("cursor", page.pageInfo.nextCursor);
  const exportParams = new URLSearchParams(filterParams);

  const canExport = context.permissions.has("audit.export");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description={organization.displayName}
        breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: organization.displayName, href: `/organizations/${id}` }, { label: "Audit log" }]}
        actions={
          canExport ? (
            <Button asChild variant="outline">
              <a href={`${basePath}/export?${exportParams.toString()}`}>
                <Download />
                Export CSV
              </a>
            </Button>
          ) : undefined
        }
      />

      <AuditFiltersForm
        action={basePath}
        values={{
          search: single(sp.search),
          category: single(sp.category),
          outcome: single(sp.outcome),
          createdAfter: single(sp.createdAfter),
          createdBefore: single(sp.createdBefore),
        }}
      />

      {(single(sp.actorUserId) || single(sp.resourceId) || single(sp.requestId) || single(sp.correlationId)) ? (
        <p className="text-sm text-muted-foreground">
          Filtered by investigation link — <Link href={basePath} className="underline">clear to see all events</Link>.
        </p>
      ) : null}

      <AuditLogTable events={page.items} detailHref={(event) => `${basePath}/${event.id}`} />

      <AuditLogPaginationControls nextHref={`${basePath}?${nextParams.toString()}`} hasNextPage={page.pageInfo.hasNextPage} />
    </div>
  );
}
