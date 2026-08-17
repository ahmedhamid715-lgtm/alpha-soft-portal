import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listOrganizationsForPlatform } from "@/server/services/organization-management-service";
import { OrganizationDirectoryTable, OrganizationDirectoryPaginationControls } from "@/components/organizations/organization-directory-table";

export const metadata: Metadata = { title: "Organizations" };

/**
 * The platform-wide organization directory (spec section 1) —
 * `organizations.read`. A NEW standalone route (`/admin/organizations`),
 * same reasoning `/admin/users`/`/admin/audit`/`/admin/roles` already
 * document for themselves: `(protected)/admin/page.tsx` stays the
 * Module 04 placeholder. Platform staff only — an organization's own
 * members reach it through `/organizations` (Module 06's switcher,
 * unchanged), never this page; this is the cross-organization,
 * platform-wide view spec section 1 itself distinguishes from that.
 */
export default async function OrganizationDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("organizations.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Organizations" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing the platform organization directory requires the organizations.read permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const cursor = single(sp.cursor);
  const search = single(sp.search);
  const status = single(sp.status) as "ACTIVE" | "SUSPENDED" | "ARCHIVED" | undefined;

  const page = await listOrganizationsForPlatform({ cursor, search, status, limit: 25 });

  const basePath = "/admin/organizations";
  const filterParams = new URLSearchParams();
  if (search) filterParams.set("search", search);
  if (status) filterParams.set("status", status);
  const nextParams = new URLSearchParams(filterParams);
  if (page.pageInfo.nextCursor) nextParams.set("cursor", page.pageInfo.nextCursor);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Organizations" description="Every Alpha OS organization, platform-wide — search, filter, and open a profile for lifecycle management." />

      <form method="get" className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="org-search" className="text-xs text-muted-foreground">
            Search
          </label>
          <input
            id="org-search"
            type="search"
            name="search"
            defaultValue={search ?? ""}
            placeholder="Name or slug…"
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="org-status-filter" className="text-xs text-muted-foreground">
            Status
          </label>
          <select id="org-status-filter" name="status" defaultValue={status ?? ""} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
            <option value="">Any status</option>
            {["ACTIVE", "SUSPENDED", "ARCHIVED"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline" size="sm">
          Filter
        </Button>
        {(search || status) ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={basePath}>Clear</Link>
          </Button>
        ) : null}
      </form>

      <OrganizationDirectoryTable organizations={page.items} detailHref={(organization) => `${basePath}/${organization.id}`} />
      <OrganizationDirectoryPaginationControls nextHref={`${basePath}?${nextParams.toString()}`} hasNextPage={page.pageInfo.hasNextPage} />
    </div>
  );
}
