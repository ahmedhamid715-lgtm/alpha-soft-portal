import Link from "next/link";
import type { AuditEvent } from "@/generated/prisma/client";
import { StatusBadge, type StatusBadgeProps } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { FileSearch } from "lucide-react";
import { isAuditActionKey } from "@/lib/audit/catalog";

function outcomeStatus(outcome: AuditEvent["outcome"]): StatusBadgeProps["status"] {
  switch (outcome) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
      return "destructive";
    case "DENIED":
      return "warning";
    default:
      return "neutral";
  }
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * The audit log's main list surface (Phase 16) — a plain server-rendered
 * table, not `DataTable` (that component owns client-side pagination
 * over data already fetched in full; the audit log is server-paginated
 * by design — see `audit-system.md` "Query & export"). Every row links
 * to the event's own detail page (`detailHref`) — the table itself never
 * renders `previousState`/`newState`/`metadata` (Phase 17: human-readable
 * summary first, raw JSON only on the detail page, and only below the
 * fold there too).
 */
export function AuditLogTable({ events, detailHref }: { events: AuditEvent[]; detailHref: (event: AuditEvent) => string }) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={FileSearch}
        title="No audit events match these filters"
        description="Try widening the date range or clearing a filter."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Audit events table, scrollable on narrow viewports">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5">When</th>
            <th className="px-4 py-2.5">Action</th>
            <th className="px-4 py-2.5">Actor</th>
            <th className="px-4 py-2.5">Resource</th>
            <th className="px-4 py-2.5">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-b border-border last:border-0 hover:bg-muted/30">
              <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                <Link href={detailHref(event)} className="hover:underline">
                  <time dateTime={event.createdAt.toISOString()}>{dateTimeFormatter.format(event.createdAt)}</time>
                </Link>
              </td>
              <td className="px-4 py-2.5">
                <Link href={detailHref(event)} className="font-medium hover:underline">
                  {event.action}
                </Link>
                {!isAuditActionKey(event.action) ? (
                  <span className="ml-2 text-xs text-muted-foreground" title="Not in the current catalog — likely an older event from a removed/renamed action.">
                    (legacy)
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-2.5">{event.actorDisplayName ?? <span className="text-muted-foreground">System</span>}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{event.resourceName ?? event.resourceType ?? "—"}</td>
              <td className="px-4 py-2.5">
                <StatusBadge status={outcomeStatus(event.outcome)}>{event.outcome}</StatusBadge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Forward-only pagination controls (Phase 15/21 — cursor, not offset;
 * see the repository's own `list()` comment). No "page 3 of 9," no
 * "previous" link — a cursor only ever points forward. Going back is the
 * browser's own back button, which re-requests the previous page's real
 * URL (this is a plain server-rendered link, not client state), landing
 * on exactly the same rows it showed before.
 */
export function AuditLogPaginationControls({ nextHref, hasNextPage }: { nextHref: string; hasNextPage: boolean }) {
  if (!hasNextPage) return null;
  return (
    <div className="flex justify-end">
      <Button asChild variant="outline" size="sm">
        <Link href={nextHref}>Next page</Link>
      </Button>
    </div>
  );
}
