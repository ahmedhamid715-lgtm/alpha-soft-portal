"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Circle, CheckCircle2, Archive, ArchiveRestore } from "lucide-react";
import type { Notification } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeProps } from "@/components/shared/status-badge";
import { useRelativeTime } from "@/components/shared/activity-timeline";
import { markReadAction, markUnreadAction, archiveNotificationAction, type NotificationActionState } from "@/app/(protected)/notifications/actions";

function severityStatus(severity: Notification["severity"]): StatusBadgeProps["status"] {
  switch (severity) {
    case "CRITICAL":
      return "destructive";
    case "WARNING":
      return "warning";
    default:
      return "info";
  }
}

const initialState: NotificationActionState = {};

/**
 * One row in the full `/notifications` list (spec section 11). A plain
 * server-rendered card with three `useActionState`-bound forms (mark
 * read/unread, archive) — no client-side fetch, same "server-paginated,
 * server-mutated" discipline the audit log already established. Each
 * action is its own tiny form so a screen reader announces exactly one
 * button per operation, not a menu that hides them.
 */
export function NotificationItem({ notification }: { notification: Notification }) {
  const [readState, readAction, readPending] = useActionState(
    notification.status === "UNREAD" ? markReadAction : markUnreadAction,
    initialState,
  );
  const [archiveState, archiveAction, archivePending] = useActionState(archiveNotificationAction, initialState);
  const relative = useRelativeTime(notification.createdAt);
  const isArchived = notification.status === "ARCHIVED";

  return (
    <li
      className="flex flex-col gap-2 border-b border-border px-4 py-3.5 last:border-0 sm:flex-row sm:items-start sm:justify-between"
      aria-current={notification.status === "UNREAD" ? "true" : undefined}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <span
          className="mt-1 size-2 shrink-0 rounded-full"
          style={{ backgroundColor: notification.status === "UNREAD" ? "var(--primary)" : "transparent" }}
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={notification.status === "UNREAD" ? "text-sm font-semibold" : "text-sm font-medium text-muted-foreground"}>
              {notification.title}
            </p>
            <StatusBadge status={severityStatus(notification.severity)}>{notification.severity}</StatusBadge>
          </div>
          <p className="text-sm text-muted-foreground">{notification.body}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <time dateTime={notification.createdAt.toISOString()}>{relative}</time>
            {notification.actionUrl ? (
              <>
                <span aria-hidden="true">·</span>
                <Link href={notification.actionUrl} className="hover:underline">
                  View
                </Link>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 self-start">
        {!isArchived ? (
          <form action={readAction}>
            <input type="hidden" name="id" value={notification.id} />
            <Button type="submit" variant="ghost" size="sm" disabled={readPending} aria-label={notification.status === "UNREAD" ? "Mark as read" : "Mark as unread"}>
              {notification.status === "UNREAD" ? <CheckCircle2 /> : <Circle />}
              {notification.status === "UNREAD" ? "Mark read" : "Mark unread"}
            </Button>
          </form>
        ) : null}
        {!isArchived ? (
          <form action={archiveAction}>
            <input type="hidden" name="id" value={notification.id} />
            <Button type="submit" variant="ghost" size="sm" disabled={archivePending} aria-label="Archive notification">
              <Archive />
              Archive
            </Button>
          </form>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ArchiveRestore className="size-3.5" aria-hidden="true" />
            Archived
          </span>
        )}
      </div>
      {readState.error ? (
        <p role="alert" className="sr-only">
          {readState.error}
        </p>
      ) : null}
      {archiveState.error ? (
        <p role="alert" className="sr-only">
          {archiveState.error}
        </p>
      ) : null}
    </li>
  );
}
