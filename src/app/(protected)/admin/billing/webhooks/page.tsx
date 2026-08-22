import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listRecentWebhookEventsForPlatform } from "@/server/services/billing-platform-service";

export const metadata: Metadata = { title: "Billing webhooks" };

const STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "neutral"> = {
  PROCESSED: "success",
  PENDING: "warning",
  FAILED: "destructive",
  IGNORED: "neutral",
};

/**
 * Provider synchronization observability (spec §18/§24/§47) —
 * `billing.readPlatform`. Deliberately a bounded, most-recent-first list
 * with no `payload` column — `listRecentWebhookEventsForPlatform()`
 * itself never returns the raw Stripe event body through this summary
 * shape (see billing-security.md). This is diagnostic visibility, not a
 * replay/retry console — Module 14 does not build a fake retry engine
 * (spec §17's own instruction); a FAILED row here is investigated by a
 * human via its `error` message and the underlying Stripe Dashboard.
 */
export default async function AdminBillingWebhooksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("billing.readPlatform")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Billing webhooks" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing platform billing requires the billing.readPlatform permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const status = single(sp.status) as "PENDING" | "PROCESSED" | "FAILED" | "IGNORED" | undefined;

  const events = await listRecentWebhookEventsForPlatform({ status, limit: 50 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Billing webhooks"
        description="The most recent 50 Stripe webhook deliveries received. Alpha OS is the source of truth — this is how provider state syncs in."
        breadcrumbs={[{ label: "Billing", href: "/admin/billing" }, { label: "Webhooks" }]}
      />

      <form method="get" className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="webhook-status-filter" className="text-xs text-muted-foreground">Status</label>
          <select id="webhook-status-filter" name="status" defaultValue={status ?? ""} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
            <option value="">Any status</option>
            {["PENDING", "PROCESSED", "FAILED", "IGNORED"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline" size="sm">Filter</Button>
        {status ? <Button asChild variant="ghost" size="sm"><Link href="/admin/billing/webhooks">Clear</Link></Button> : null}
      </form>

      {events.length === 0 ? (
        <EmptyState title="No webhook events" description="No Stripe webhook deliveries have been received yet." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Processed</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="font-mono text-xs">{event.eventType}</TableCell>
                  <TableCell><StatusBadge status={STATUS_TONE[event.status] ?? "neutral"}>{event.status}</StatusBadge></TableCell>
                  <TableCell>{new Date(event.receivedAt).toLocaleString()}</TableCell>
                  <TableCell>{event.processedAt ? new Date(event.processedAt).toLocaleString() : "—"}</TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={event.error ?? undefined}>{event.error ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
