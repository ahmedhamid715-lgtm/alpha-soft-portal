import Link from "next/link";
import type { Organization } from "@/generated/prisma/client";
import { StatusBadge, type StatusBadgeProps } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Building2 } from "lucide-react";

function statusBadge(status: Organization["status"]): StatusBadgeProps["status"] {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "SUSPENDED":
      return "warning";
    case "ARCHIVED":
      return "neutral";
  }
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

/**
 * The platform-wide organization directory's own list (spec section 1)
 * — a plain server-rendered table, not the client-side `DataTable`:
 * same "server-paginated by design" reasoning `AuditLogTable`/Module
 * 10's `UserDirectoryTable` already document — this table follows that
 * precedent for the same unbounded-dataset reason.
 */
export function OrganizationDirectoryTable({ organizations, detailHref }: { organizations: Organization[]; detailHref: (organization: Organization) => string }) {
  if (organizations.length === 0) {
    return <EmptyState icon={Building2} title="No organizations match these filters" description="Try widening or clearing a filter." />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Organization directory table, scrollable on narrow viewports">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5">Organization</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Created</th>
          </tr>
        </thead>
        <tbody>
          {organizations.map((organization) => (
            <tr key={organization.id} className="border-b border-border last:border-0 hover:bg-muted/30">
              <td className="px-4 py-2.5">
                <Link href={detailHref(organization)} className="flex flex-col hover:underline">
                  <span className="font-medium">{organization.displayName}</span>
                  <span className="text-xs text-muted-foreground">{organization.slug}</span>
                </Link>
              </td>
              <td className="px-4 py-2.5">
                <StatusBadge status={statusBadge(organization.status)}>{organization.status}</StatusBadge>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{dateTimeFormatter.format(organization.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Forward-only cursor pagination — same shape as `AuditLogPaginationControls`/Module 10's `UserDirectoryPaginationControls`. */
export function OrganizationDirectoryPaginationControls({ nextHref, hasNextPage }: { nextHref: string; hasNextPage: boolean }) {
  if (!hasNextPage) return null;
  return (
    <div className="flex justify-end">
      <Button asChild variant="outline" size="sm">
        <Link href={nextHref}>Next page</Link>
      </Button>
    </div>
  );
}
