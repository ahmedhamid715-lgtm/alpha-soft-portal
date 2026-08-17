import type { Metadata } from "next";
import Link from "next/link";
import { BellOff, CheckCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { notificationService } from "@/lib/notifications/service";
import { NOTIFICATION_CATEGORY_KEYS, getNotificationCategoryDefinition } from "@/lib/notifications/categories";
import { NotificationItem } from "@/components/notifications/notification-item";
import { markAllReadAction } from "./actions";

export const metadata: Metadata = { title: "Notifications" };

const STATUS_TABS = [
  { key: undefined, label: "All" },
  { key: "UNREAD", label: "Unread" },
  { key: "READ", label: "Read" },
  { key: "ARCHIVED", label: "Archived" },
] as const;

/**
 * The full notification center (spec section 11) — this session's own
 * feed only; `notificationService.getUserNotifications()` structurally
 * cannot return anyone else's rows (no `recipientUserId` parameter — see
 * `service.ts`). Server-paginated (cursor, not offset — spec's own
 * explicit instruction) and server-filtered, same shape as the audit
 * log's own list page rather than a client-side `DataTable` over
 * everything at once.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const status = single(sp.status) as "UNREAD" | "READ" | "ARCHIVED" | undefined;
  const category = single(sp.category);
  const cursor = single(sp.cursor);

  const page = await notificationService.getUserNotifications({ status, category, cursor, limit: 25 });

  const basePath = "/notifications";
  const filterParams = new URLSearchParams();
  if (status) filterParams.set("status", status);
  if (category) filterParams.set("category", category);
  const nextParams = new URLSearchParams(filterParams);
  if (page.pageInfo.nextCursor) nextParams.set("cursor", page.pageInfo.nextCursor);

  const tabHref = (key: string | undefined) => {
    const params = new URLSearchParams();
    if (key) params.set("status", key);
    if (category) params.set("category", category);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="Everything Alpha OS has sent to you — across every organization you belong to."
        actions={
          <form action={markAllReadAction}>
            <Button type="submit" variant="outline" size="sm">
              <CheckCheck />
              Mark all read
            </Button>
          </form>
        }
      />

      <div className="flex flex-wrap items-center gap-4 border-b border-border">
        <nav aria-label="Filter by status" className="flex gap-1">
          {STATUS_TABS.map((tab) => {
            const active = (tab.key ?? undefined) === status;
            return (
              <Link
                key={tab.label}
                href={tabHref(tab.key)}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "border-b-2 border-primary px-3 py-2 text-sm font-medium text-foreground"
                    : "border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                }
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        {/* Plain `<form method="get">` — every filter is already a URL search
            param the page itself reads server-side, same "no JS required to
            filter" discipline `AuditFiltersForm` established. Submitting
            reloads with the new query string; the result is directly
            shareable/bookmarkable. */}
        <form method="get" className="ml-auto flex items-center gap-2 py-2">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <label htmlFor="notification-category-filter" className="text-sm text-muted-foreground">
            Category
          </label>
          <select
            id="notification-category-filter"
            name="category"
            defaultValue={category ?? ""}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="">All categories</option>
            {NOTIFICATION_CATEGORY_KEYS.map((key) => (
              <option key={key} value={key}>
                {getNotificationCategoryDefinition(key).label}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" size="sm">
            Filter
          </Button>
        </form>
      </div>

      {page.items.length === 0 ? (
        <EmptyState icon={BellOff} title="No notifications" description="You're all caught up — nothing matches these filters." />
      ) : (
        <ul className="flex flex-col rounded-lg border border-border">
          {page.items.map((notification) => (
            <NotificationItem key={notification.id} notification={notification} />
          ))}
        </ul>
      )}

      {page.pageInfo.hasNextPage ? (
        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <Link href={`${basePath}?${nextParams.toString()}`}>Next page</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
