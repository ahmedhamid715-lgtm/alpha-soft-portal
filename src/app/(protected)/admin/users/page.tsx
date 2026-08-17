import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listUsers } from "@/server/services/user-management-service";
import { UserDirectoryTable, UserDirectoryPaginationControls } from "@/components/users/user-directory-table";

export const metadata: Metadata = { title: "Users" };

/**
 * The platform-wide user directory (spec section 1) — `users.read`. A
 * NEW standalone route (`/admin/users`), same reasoning `/admin/audit`
 * and `/admin/roles` already document for themselves:
 * `(protected)/admin/page.tsx` stays the Module 04 placeholder, never
 * retrofitted. Platform staff only — an organization admin's own member
 * directory stays exactly where Module 07 built it
 * (`/organizations/[id]/members`), scoped to their one organization;
 * this page is the cross-organization, platform-wide view spec section 1
 * itself distinguishes ("platform staff may have platform-level
 * visibility... organization users must only see users permitted by
 * their organization scope" — the latter is `/organizations/[id]/members`,
 * unchanged by this module).
 */
export default async function UserDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("users.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Users" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing the platform user directory requires the users.read permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const cursor = single(sp.cursor);
  const search = single(sp.search);
  const status = single(sp.status) as "INVITED" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED" | undefined;

  const page = await listUsers({ cursor, search, status, limit: 25 });

  const basePath = "/admin/users";
  const filterParams = new URLSearchParams();
  if (search) filterParams.set("search", search);
  if (status) filterParams.set("status", status);
  const nextParams = new URLSearchParams(filterParams);
  if (page.pageInfo.nextCursor) nextParams.set("cursor", page.pageInfo.nextCursor);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        description="Every Alpha OS identity, platform-wide — search, filter, and open a profile for full detail."
        actions={
          context.permissions.has("users.create") ? (
            <Button asChild>
              <Link href="/admin/users/new">
                <UserPlus />
                Create platform user
              </Link>
            </Button>
          ) : undefined
        }
      />

      <form method="get" className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="user-search" className="text-xs text-muted-foreground">
            Search
          </label>
          <input
            id="user-search"
            type="search"
            name="search"
            defaultValue={search ?? ""}
            placeholder="Name or email…"
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="user-status-filter" className="text-xs text-muted-foreground">
            Status
          </label>
          <select id="user-status-filter" name="status" defaultValue={status ?? ""} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
            <option value="">Any status</option>
            {["INVITED", "ACTIVE", "SUSPENDED", "DEACTIVATED"].map((s) => (
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

      <UserDirectoryTable users={page.items} detailHref={(user) => `${basePath}/${user.id}`} />
      <UserDirectoryPaginationControls nextHref={`${basePath}?${nextParams.toString()}`} hasNextPage={page.pageInfo.hasNextPage} />
    </div>
  );
}
