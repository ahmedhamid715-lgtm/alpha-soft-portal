import Link from "next/link";
import type { User } from "@/generated/prisma/client";
import { StatusBadge, type StatusBadgeProps } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";

function statusBadge(status: User["status"]): StatusBadgeProps["status"] {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "SUSPENDED":
      return "warning";
    case "DEACTIVATED":
      return "destructive";
    default:
      return "neutral";
  }
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

/**
 * The platform-wide user directory's own list (spec section 1) — a
 * plain server-rendered table, not the client-side `DataTable`
 * component: `DataTable` owns pagination/filtering over data already
 * fetched IN FULL, which is exactly what spec section 19 forbids for a
 * dataset that grows unbounded over the platform's lifetime. Same
 * "server-paginated by design" reasoning `AuditLogTable` already
 * documents for itself — this table follows that precedent, not
 * `members-table.tsx`'s (that one's dataset — one organization's own
 * roster — is legitimately bounded).
 */
export function UserDirectoryTable({ users, detailHref }: { users: User[]; detailHref: (user: User) => string }) {
  if (users.length === 0) {
    return <EmptyState icon={Users} title="No users match these filters" description="Try widening or clearing a filter." />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="User directory table, scrollable on narrow viewports">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5">User</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Email verified</th>
            <th className="px-4 py-2.5">Last sign-in</th>
            <th className="px-4 py-2.5">Created</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/30">
              <td className="px-4 py-2.5">
                <Link href={detailHref(user)} className="flex flex-col hover:underline">
                  <span className="font-medium">{user.name}</span>
                  <span className="text-xs text-muted-foreground">{user.email}</span>
                </Link>
              </td>
              <td className="px-4 py-2.5">
                <StatusBadge status={statusBadge(user.status)}>{user.status}</StatusBadge>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{user.emailVerifiedAt ? "Verified" : "Unverified"}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{user.lastLoginAt ? dateTimeFormatter.format(user.lastLoginAt) : "Never"}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{dateTimeFormatter.format(user.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Forward-only cursor pagination — same shape as `AuditLogPaginationControls`. */
export function UserDirectoryPaginationControls({ nextHref, hasNextPage }: { nextHref: string; hasNextPage: boolean }) {
  if (!hasNextPage) return null;
  return (
    <div className="flex justify-end">
      <Button asChild variant="outline" size="sm">
        <Link href={nextHref}>Next page</Link>
      </Button>
    </div>
  );
}
