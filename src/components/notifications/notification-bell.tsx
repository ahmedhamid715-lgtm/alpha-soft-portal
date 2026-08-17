"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Bell } from "lucide-react";
import type { Notification } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRelativeTime } from "@/components/shared/activity-timeline";
import { getBellDataAction, markNotificationReadFromBellAction } from "@/app/(protected)/notifications/actions";

const POLL_INTERVAL_MS = 45_000;

/**
 * The in-app notification trigger (spec section 11) — bell + unread
 * badge + a small popover preview, mounted once in the shared protected
 * header (`(protected)/layout.tsx`). No realtime transport exists yet
 * (no websockets/SSE anywhere in this codebase) — polling
 * `getBellDataAction()` (a plain Server Action called directly, not a
 * new API route) on an interval is the honest, undressed-up equivalent,
 * same "don't fake infrastructure that doesn't exist" discipline
 * `lib/notifications/delivery.ts` applies to the retry queue. Paused
 * while the tab is hidden (`document.visibilityState`) so a user with
 * many idle background tabs doesn't multiply request volume for no
 * benefit.
 */
export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [recent, setRecent] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    getBellDataAction()
      .then((data) => {
        if (!mountedRef.current) return;
        setUnreadCount(data.unreadCount);
        setRecent(data.recent);
      })
      .catch(() => {
        // Best-effort — a failed poll just means the badge is stale until
        // the next tick; never surface an error UI for a background refresh.
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refresh]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) refresh();
  };

  const handleItemClick = (id: string, status: Notification["status"]) => {
    if (status !== "UNREAD") return;
    setRecent((prev) => prev.map((n) => (n.id === id ? { ...n, status: "READ" } : n)));
    setUnreadCount((count) => Math.max(0, count - 1));
    startTransition(() => {
      markNotificationReadFromBellAction(id);
    });
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}>
          <Bell />
          {unreadCount > 0 ? (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-4.5 min-w-4.5 justify-center rounded-full px-1 text-[10px] leading-none"
              aria-hidden="true"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <p className="text-sm font-medium">Notifications</p>
          <Link href="/notifications" className="text-xs text-muted-foreground hover:underline" onClick={() => setOpen(false)}>
            View all
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
        ) : (
          <ul className="flex max-h-80 flex-col overflow-y-auto">
            {recent.map((notification) => (
              <BellItem key={notification.id} notification={notification} onClick={handleItemClick} />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function BellItem({ notification, onClick }: { notification: Notification; onClick: (id: string, status: Notification["status"]) => void }) {
  const relative = useRelativeTime(notification.createdAt);
  return (
    <li>
      <Link
        href={notification.actionUrl ?? "/notifications"}
        onClick={() => onClick(notification.id, notification.status)}
        className="flex flex-col gap-0.5 border-b border-border px-3 py-2.5 text-sm last:border-0 hover:bg-muted/50"
      >
        <span className="flex items-center gap-2">
          {notification.status === "UNREAD" ? <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" /> : null}
          <span className={notification.status === "UNREAD" ? "font-medium" : "text-muted-foreground"}>{notification.title}</span>
        </span>
        <span className="pl-3.5 text-xs text-muted-foreground">{relative}</span>
      </Link>
    </li>
  );
}
