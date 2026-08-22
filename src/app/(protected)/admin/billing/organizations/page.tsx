import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listOrganizationsBillingForPlatform } from "@/server/services/billing-platform-service";

export const metadata: Metadata = { title: "Billing organizations" };

const ACCOUNT_STATUS_TONE: Record<string, "success" | "warning" | "destructive"> = {
  ACTIVE: "success",
  PAST_DUE: "warning",
  SUSPENDED: "destructive",
  CLOSED: "destructive",
};
const SUBSCRIPTION_STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "neutral" | "info"> = {
  ACTIVE: "success",
  TRIALING: "info",
  PAST_DUE: "warning",
  UNPAID: "destructive",
  PAUSED: "warning",
  CANCELED: "neutral",
  INCOMPLETE: "neutral",
  INCOMPLETE_EXPIRED: "destructive",
};

/**
 * Platform billing directory (spec §24, Module 13) — `billing.readPlatform`.
 * Moved here from `/admin/billing` itself (Module 15) — that route is
 * now the financial intelligence DASHBOARD; this per-organization
 * directory is one level down, exactly the same content/behavior as
 * before. Deliberately narrow: organization identity, billing account
 * status, current subscription status — never a payment-method number,
 * never a raw Stripe payload (see billing-security.md).
 */
export default async function AdminBillingOrganizationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("billing.readPlatform")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Billing organizations" breadcrumbs={[{ label: "Billing", href: "/admin/billing" }, { label: "Organizations" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing platform billing requires the billing.readPlatform permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const cursor = single(sp.cursor);
  const status = single(sp.status) as "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CLOSED" | undefined;

  const page = await listOrganizationsBillingForPlatform({ cursor, status, limit: 25 });
  const basePath = "/admin/billing/organizations";
  const nextParams = new URLSearchParams();
  if (status) nextParams.set("status", status);
  if (page.pageInfo.nextCursor) nextParams.set("cursor", page.pageInfo.nextCursor);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Billing organizations"
        description="Every organization's billing status, platform-wide."
        breadcrumbs={[{ label: "Billing", href: "/admin/billing" }, { label: "Organizations" }]}
      />

      <form method="get" className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="billing-status-filter" className="text-xs text-muted-foreground">Account status</label>
          <select id="billing-status-filter" name="status" defaultValue={status ?? ""} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
            <option value="">Any status</option>
            {["ACTIVE", "PAST_DUE", "SUSPENDED", "CLOSED"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline" size="sm">Filter</Button>
        {status ? <Button asChild variant="ghost" size="sm"><Link href={basePath}>Clear</Link></Button> : null}
      </form>

      {page.items.length === 0 ? (
        <EmptyState title="No billing accounts" description="No organization has started billing yet." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Account status</TableHead>
                <TableHead>Subscription</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((row) => (
                <TableRow key={row.organizationId}>
                  <TableCell>
                    <Link href={`/admin/billing/organizations/${row.organizationId}`} className="font-medium text-link hover:underline">
                      {row.organizationName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {row.billingAccount ? <StatusBadge status={ACCOUNT_STATUS_TONE[row.billingAccount.status] ?? "neutral"}>{row.billingAccount.status}</StatusBadge> : "—"}
                  </TableCell>
                  <TableCell>
                    {row.subscriptionStatus ? <StatusBadge status={SUBSCRIPTION_STATUS_TONE[row.subscriptionStatus] ?? "neutral"}>{row.subscriptionStatus}</StatusBadge> : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {page.pageInfo.hasNextPage ? (
        <Button asChild variant="outline" className="w-fit">
          <Link href={`${basePath}?${nextParams.toString()}`}>Next page</Link>
        </Button>
      ) : null}
    </div>
  );
}
