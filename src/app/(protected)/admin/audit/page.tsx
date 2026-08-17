import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listPlatformAuditEvents } from "@/lib/audit/query";
import { AuditFiltersForm } from "@/components/audit/audit-filters-form";
import { AuditLogTable, AuditLogPaginationControls } from "@/components/audit/audit-log-table";

export const metadata: Metadata = { title: "Platform audit log" };

/**
 * Platform-wide audit events (Phase 16) — `audit.readPlatform`. A NEW,
 * standalone route (`/admin/audit`), same reasoning `/admin/roles`
 * documents for its own page: `(protected)/admin/page.tsx` is a Module 04
 * placeholder reserved for Module 09's real Admin Command Center, not a
 * page to retrofit here.
 *
 * Deliberately platform-scoped only — this page can never show a
 * customer organization's own audit trail (`listPlatformAuditEvents()`
 * is structurally limited to `organizationId IS NULL` plus the platform
 * organization's own id — see `audit-system.md` "Platform vs.
 * organization audit"). A platform admin investigating a specific
 * customer organization's activity goes to that organization's own
 * `/organizations/{id}/audit` — this page never substitutes for it.
 */
export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("audit.readPlatform")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Platform audit log" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing the platform audit log requires the audit.readPlatform permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const query = {
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

  const page = await listPlatformAuditEvents(query);

  const basePath = "/admin/audit";
  const filterParams = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (key === "cursor") continue;
    const v = single(value);
    if (v) filterParams.set(key, v);
  }
  const nextParams = new URLSearchParams(filterParams);
  if (page.pageInfo.nextCursor) nextParams.set("cursor", page.pageInfo.nextCursor);
  const exportParams = new URLSearchParams(filterParams);

  const canExport = context.permissions.has("audit.exportPlatform");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Platform audit log"
        description="Platform-wide security and administrative events — never a customer organization's own audit trail."
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
