import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { getPortalNotifications } from "@/server/services/portal/portal-notifications-service";
import { NotificationItem } from "@/components/notifications/notification-item";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export const metadata: Metadata = { title: "Notifications" };

const STATUS_TABS = [
  { key: undefined, label: "All" },
  { key: "UNREAD", label: "Unread" },
  { key: "READ", label: "Read" },
  { key: "ARCHIVED", label: "Archived" },
] as const;

/**
 * Portal's own notification feed (Build 26) — same `NotificationItem`
 * component/actions the generic `/notifications` page uses (real mark-
 * read/unread/archive, not reimplemented), but filtered to THIS
 * organization via `getPortalNotifications()` — see that service's own
 * top comment for why.
 */
export default async function PortalNotificationsPage({ searchParams }: PageProps<"/portal/notifications">) {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Notifications" />;

  const sp = await searchParams;
  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const status = single(sp.status) as "UNREAD" | "READ" | "ARCHIVED" | undefined;
  const cursor = single(sp.cursor);

  const page = await getPortalNotifications({ organizationId: guard.organizationId, status, cursor, limit: 25 });

  const tabHref = (key: string | undefined) => (key ? `/portal/notifications?status=${key}` : "/portal/notifications");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Notifications" breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "Notifications" }]} />

      <div className="flex gap-2">
        {STATUS_TABS.map((tab) => (
          <Button key={tab.label} asChild variant={status === tab.key ? "default" : "outline"} size="sm">
            <Link href={tabHref(tab.key)}>{tab.label}</Link>
          </Button>
        ))}
      </div>

      {page.items.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications" />
      ) : (
        <ul className="flex flex-col rounded-lg border border-border">
          {page.items.map((n) => (
            <NotificationItem key={n.id} notification={n} />
          ))}
        </ul>
      )}

      {page.pageInfo.hasNextPage && page.pageInfo.nextCursor ? (
        <Button asChild variant="outline" className="w-fit">
          <Link href={`/portal/notifications?${status ? `status=${status}&` : ""}cursor=${page.pageInfo.nextCursor}`}>Next page</Link>
        </Button>
      ) : null}
    </div>
  );
}
