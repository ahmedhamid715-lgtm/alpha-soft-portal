import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, MailWarning } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge, type StatusBadgeProps } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listDeliveries, getProviderStatus } from "@/lib/notifications/observability";
import type { NotificationDelivery } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Notification delivery" };

function statusBadge(status: NotificationDelivery["status"]): StatusBadgeProps["status"] {
  switch (status) {
    case "SENT":
      return "success";
    case "FAILED":
      return "destructive";
    case "PENDING":
    case "PROCESSING":
      return "warning";
    default:
      return "neutral";
  }
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/**
 * Platform observability (spec section 14) — `notifications.observability`.
 * Delivery internals ONLY (channel, provider, status, failure code/reason)
 * — never `Notification.title`/`body` for a customer's own message; see
 * `lib/notifications/observability.ts`'s own doc comment and
 * `notification-security.md` "What platform staff can and cannot see."
 * Same standalone-route reasoning `/admin/audit` documents for itself —
 * `(protected)/admin/page.tsx` stays the Module 04 placeholder.
 */
export default async function NotificationObservabilityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("notifications.observability")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Notification delivery" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing delivery status requires the notifications.observability permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const cursor = single(sp.cursor);
  const status = single(sp.status) as NotificationDelivery["status"] | undefined;
  const channel = single(sp.channel) as NotificationDelivery["channel"] | undefined;

  const [page, providerStatus] = await Promise.all([
    listDeliveries({ cursor, status, channel, limit: 25 }),
    context.permissions.has("notifications.manageProvider") ? getProviderStatus() : Promise.resolve(null),
  ]);

  const basePath = "/admin/notifications";
  const filterParams = new URLSearchParams();
  if (status) filterParams.set("status", status);
  if (channel) filterParams.set("channel", channel);
  const nextParams = new URLSearchParams(filterParams);
  if (page.pageInfo.nextCursor) nextParams.set("cursor", page.pageInfo.nextCursor);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notification delivery"
        description="Operational visibility into delivery attempts across every organization — never a customer's own notification content."
      />

      {providerStatus ? (
        <div className="flex items-center gap-2 rounded-lg border border-border px-4 py-3 text-sm">
          <span className="text-muted-foreground">Email provider:</span>
          <span className="font-medium">{providerStatus.name}</span>
          <StatusBadge status={providerStatus.valid ? "success" : "warning"}>{providerStatus.valid ? "Configured" : "Not configured"}</StatusBadge>
          {providerStatus.reason ? <span className="text-muted-foreground">— {providerStatus.reason}</span> : null}
        </div>
      ) : null}

      <form method="get" className="flex flex-wrap items-center gap-2">
        <select name="status" defaultValue={status ?? ""} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
          <option value="">Any status</option>
          {["PENDING", "PROCESSING", "SENT", "FAILED", "CANCELLED"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select name="channel" defaultValue={channel ?? ""} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
          <option value="">Any channel</option>
          {["IN_APP", "EMAIL", "SMS", "PUSH"].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm">
          Filter
        </Button>
      </form>

      {page.items.length === 0 ? (
        <EmptyState icon={MailWarning} title="No deliveries match these filters" description="Try widening or clearing a filter." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Notification deliveries table, scrollable on narrow viewports">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Queued</th>
                <th className="px-4 py-2.5">Channel</th>
                <th className="px-4 py-2.5">Provider</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Attempts</th>
                <th className="px-4 py-2.5">Failure</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((delivery) => (
                <tr key={delivery.id} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    <time dateTime={delivery.queuedAt.toISOString()}>{dateTimeFormatter.format(delivery.queuedAt)}</time>
                  </td>
                  <td className="px-4 py-2.5">{delivery.channel}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{delivery.provider}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={statusBadge(delivery.status)}>{delivery.status}</StatusBadge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{delivery.attemptCount}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {delivery.failureCode ? (
                      <span title={delivery.failureReason ?? undefined}>{delivery.failureCode}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
