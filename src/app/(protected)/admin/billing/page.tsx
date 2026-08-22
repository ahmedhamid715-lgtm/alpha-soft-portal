import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, TrendingUp, Users, AlertTriangle, Receipt, Wallet, Undo2, Gift } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { MetricCard } from "@/components/shared/metric-card";
import { AreaChart, type ChartConfig } from "@/components/shared/charts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getPlatformMrrSummary, getPlatformMrrMovement } from "@/server/services/mrr-service";
import { getPlatformRevenueReport, getPlatformAgingReport } from "@/server/services/revenue-reporting-service";
import { listAtRiskOrganizations } from "@/server/services/financial-health-service";
import { getPlatformBillingTrends } from "@/server/services/billing-trends-service";
import { formatMoney } from "@/lib/utils/money";
import { AGING_BUCKET_LABELS } from "@/lib/billing/reporting/aging";
import { FINANCIAL_HEALTH_LABELS, FINANCIAL_HEALTH_TONE } from "@/lib/billing/reporting/financial-health";
import { MetricInfo } from "./metric-info";

export const metadata: Metadata = { title: "Billing" };

const SUBSCRIPTION_LABELS: Record<string, string> = { ACTIVE: "Active", TRIALING: "Trialing", PAST_DUE: "Past due", CANCELED: "Canceled", PAUSED: "Paused", INCOMPLETE: "Incomplete", INCOMPLETE_EXPIRED: "Incomplete (expired)", UNPAID: "Unpaid" };

/**
 * The platform financial command view (spec §1) — `billing.analytics.read`.
 * Every figure states exactly what it measures (see each `MetricInfo`
 * tooltip and `docs/architecture/revenue-metrics.md` for the full
 * definitions); this page never blends BILLED, COLLECTED, and MRR into
 * one undifferentiated "revenue" number. All reads are independent,
 * parallel, already-tenant-scoped service calls (`Promise.all` below) —
 * no aggregation here bypasses `withTenantContext()` or RLS (every one
 * of these service functions does its own `resolvePlatformContext()` +
 * `withTenantContext({isPlatformStaff: true})`, proven in
 * `billing-reporting-rls.test.ts`).
 */
export default async function AdminBillingPage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("billing.analytics.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Billing" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing platform billing intelligence requires the billing.analytics.read permission." />
      </div>
    );
  }

  const [mrr, movement, revenue, aging, atRisk, trends] = await Promise.all([
    getPlatformMrrSummary(),
    getPlatformMrrMovement({ period: "current_month" }),
    getPlatformRevenueReport({ period: "current_month" }),
    getPlatformAgingReport(),
    listAtRiskOrganizations(),
    getPlatformBillingTrends({ period: "current_year", buckets: 12 }),
  ]);

  const primaryCurrency = mrr.byCurrency[0]?.currency ?? null;
  const totalOutstanding = aging.totalOutstandingByCurrency;

  const trendChartData = trends.mrr.map((point, i) => {
    const row: Record<string, unknown> = { label: point.bucketStart.toLocaleDateString("en-US", { month: "short" }) };
    for (const currency of mrr.byCurrency.map((r) => r.currency)) {
      row[currency] = (trends.mrr[i]?.byCurrency.find((c) => c.currency === currency)?.amount ?? 0) / 100;
    }
    return row;
  });
  const trendChartConfig: ChartConfig = Object.fromEntries(mrr.byCurrency.map((r, i) => [r.currency, { label: `MRR (${r.currency})`, color: `var(--chart-${(i % 5) + 1})` }]));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Billing"
        description="Platform-wide financial intelligence. MRR, revenue, receivables, and financial health — never a substitute for GAAP accounting (see the definitions in each metric's info icon)."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href="/admin/billing/organizations">Organizations</Link></Button>
            <Button asChild variant="outline"><Link href="/admin/billing/controls">Controls</Link></Button>
            <Button asChild variant="outline"><Link href="/admin/billing/webhooks">Webhooks</Link></Button>
            <Button asChild variant="outline"><Link href="/admin/billing/reports">Reports</Link></Button>
          </div>
        }
      />

      {/* --- MRR / ARR, per currency ------------------------------------ */}
      <section className="flex flex-col gap-4">
        <SectionHeader title="Recurring revenue" description="Contractual monthly/annual recurring value — not cash collected, not GAAP revenue." />
        {mrr.byCurrency.length === 0 ? (
          <EmptyState title="No recurring revenue yet" description="No ACTIVE or PAST_DUE subscription currently exists." />
        ) : (
          <div className="flex flex-col gap-4">
            {mrr.byCurrency.map((row) => (
              <div key={row.currency} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <MetricCard
                  label={`MRR (${row.currency})`}
                  value={formatMoney(row.mrr, row.currency)}
                  icon={TrendingUp}
                  info={<MetricInfo definition="Monthly Recurring Revenue: the sum of the monthly-equivalent value of every ACTIVE or PAST_DUE subscription's current items. Yearly prices are divided by 12. Excludes trials, credits, and discounts not represented in the catalog." />}
                />
                <MetricCard
                  label={`ARR (${row.currency})`}
                  value={formatMoney(row.arr, row.currency)}
                  icon={TrendingUp}
                  info={<MetricInfo definition="Annual Recurring Revenue = MRR × 12. A simple annualization of CURRENT recurring commitment — not a forecast, not GAAP annual revenue." />}
                />
                <MetricCard label={`Subscriptions (${row.currency})`} value={String(row.subscriptionCount)} icon={Users} />
                <MetricCard
                  label="Net MRR change (this month)"
                  value={`${(movement.summary.find((m) => m.currency === row.currency)?.netChange ?? 0) >= 0 ? "+" : ""}${formatMoney(movement.summary.find((m) => m.currency === row.currency)?.netChange ?? 0, row.currency)}`}
                  trend={(movement.summary.find((m) => m.currency === row.currency)?.netChange ?? 0) >= 0 ? "up" : "down"}
                  info={<MetricInfo definition="New + Expansion + Contraction + Churn + Reactivation MRR for the current month. See the movement definitions below." />}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* --- Subscription status counts ---------------------------------- */}
      <section className="flex flex-col gap-4">
        <SectionHeader title="Subscriptions by status" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
          {Object.entries(mrr.subscriptionStatusCounts).map(([status, count]) => (
            <MetricCard key={status} label={SUBSCRIPTION_LABELS[status] ?? status} value={String(count)} />
          ))}
        </div>
      </section>

      {/* --- MRR movement --------------------------------------------------- */}
      <section className="flex flex-col gap-4">
        <SectionHeader title="MRR movement (this month)" description="Classified from real subscription/plan-change history — see docs/architecture/revenue-metrics.md for the exact method and its documented limitations." />
        {movement.summary.length === 0 ? (
          <EmptyState title="No MRR movement this month" />
        ) : (
          movement.summary.map((row) => (
            <div key={row.currency} className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <MetricCard label={`New (${row.currency})`} value={formatMoney(row.newMrr, row.currency)} trend="up" />
              <MetricCard label={`Expansion (${row.currency})`} value={formatMoney(row.expansionMrr, row.currency)} trend="up" />
              <MetricCard label={`Contraction (${row.currency})`} value={formatMoney(row.contractionMrr, row.currency)} trend="down" />
              <MetricCard label={`Churned (${row.currency})`} value={formatMoney(row.churnedMrr, row.currency)} trend="down" />
              <MetricCard label={`Reactivation (${row.currency})`} value={formatMoney(row.reactivationMrr, row.currency)} trend="up" />
            </div>
          ))
        )}
      </section>

      {/* --- MRR trend chart -------------------------------------------- */}
      {primaryCurrency ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="MRR over time" description="Current year, monthly buckets. Historical buckets are reconstructed from currently-alive subscriptions and may not reflect exact then-current pricing for a subscription that has since changed plans — see revenue-metrics.md." />
          <Card>
            <CardContent>
              <AreaChart data={trendChartData} config={trendChartConfig} xKey="label" seriesKeys={mrr.byCurrency.map((r) => r.currency)} className="h-64 w-full" />
            </CardContent>
          </Card>
          {/* Accessible data-table equivalent of the chart above (spec §25: "charts must have accessible textual summaries") */}
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  {mrr.byCurrency.map((r) => <TableHead key={r.currency} className="text-right">{r.currency}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {trends.mrr.map((point, i) => (
                  <TableRow key={i}>
                    <TableCell>{point.bucketStart.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</TableCell>
                    {mrr.byCurrency.map((r) => (
                      <TableCell key={r.currency} className="text-right tabular-nums">{formatMoney(point.byCurrency.find((c) => c.currency === r.currency)?.amount ?? 0, r.currency)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      {/* --- Billed / collected / refunded / credits --------------------- */}
      <section className="flex flex-col gap-4">
        <SectionHeader title="Revenue this month" description="Billed, collected, refunded, and credits issued are four DIFFERENT things — see each tile's own definition." />
        {revenue.billed.length === 0 && revenue.collected.length === 0 ? (
          <EmptyState title="No billing activity this month" />
        ) : (
          [...new Set([...revenue.billed.map((r) => r.currency), ...revenue.collected.map((r) => r.currency)])].sort().map((currency) => (
            <div key={currency} className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetricCard
                label={`Billed (${currency})`}
                value={formatMoney(revenue.billed.find((r) => r.currency === currency)?.total ?? 0, currency)}
                icon={Receipt}
                info={<MetricInfo definition="The total of every non-draft invoice ISSUED this month — what was billed, regardless of whether it has been collected yet." />}
              />
              <MetricCard
                label={`Collected (${currency})`}
                value={formatMoney(revenue.collected.find((r) => r.currency === currency)?.amount ?? 0, currency)}
                icon={Wallet}
                info={<MetricInfo definition="Real cash that actually arrived — the sum of SUCCEEDED payments PAID this month, regardless of which invoice (if any) they're linked to." />}
              />
              <MetricCard
                label={`Refunded (${currency})`}
                value={formatMoney(revenue.refunded.find((r) => r.currency === currency)?.amount ?? 0, currency)}
                icon={Undo2}
                info={<MetricInfo definition="Cash given back — the sum of SUCCEEDED refunds issued this month." />}
              />
              <MetricCard
                label={`Credits issued (${currency})`}
                value={formatMoney(revenue.creditsIssued.find((r) => r.currency === currency)?.amount ?? 0, currency)}
                icon={Gift}
                info={<MetricInfo definition="Promotional/goodwill credits issued this month — applied to a FUTURE invoice, not cash movement. Never subtracted from MRR." />}
              />
            </div>
          ))
        )}
      </section>

      {/* --- AR aging ------------------------------------------------------ */}
      <section className="flex flex-col gap-4">
        <SectionHeader title="Accounts receivable aging" description="Every OPEN invoice with a positive outstanding balance, bucketed by days overdue, as of now." />
        {totalOutstanding.length === 0 ? (
          <EmptyState title="No outstanding receivables" description="Every invoice is either paid, not yet due, or has no due date." />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {totalOutstanding.map((row) => (
                <MetricCard key={row.currency} label={`Outstanding (${row.currency})`} value={formatMoney(row.amount, row.currency)} icon={AlertTriangle} />
              ))}
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Bucket</TableHead><TableHead>Currency</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Invoices</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {aging.buckets.map((bucket, i) => (
                    <TableRow key={i}>
                      <TableCell>{AGING_BUCKET_LABELS[bucket.bucket]}</TableCell>
                      <TableCell>{bucket.currency}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(bucket.amount, bucket.currency)}</TableCell>
                      <TableCell className="text-right tabular-nums">{bucket.invoiceCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>

      {/* --- At-risk organizations ---------------------------------------- */}
      <section className="flex flex-col gap-4">
        <SectionHeader title="At-risk organizations" description="Deterministic financial-health classification — every classification names its exact reasons, never a black-box score." />
        {atRisk.length === 0 ? (
          <EmptyState title="No at-risk organizations" description="Every organization is currently HEALTHY or WATCH." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Organization</TableHead><TableHead>Status</TableHead><TableHead>Reasons</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {atRisk.map((row) => (
                  <TableRow key={row.organizationId}>
                    <TableCell>
                      <Link href={`/admin/billing/organizations/${row.organizationId}`} className="font-medium text-link hover:underline">{row.organizationName}</Link>
                    </TableCell>
                    <TableCell><StatusBadge status={FINANCIAL_HEALTH_TONE[row.health.classification]}>{FINANCIAL_HEALTH_LABELS[row.health.classification]}</StatusBadge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.health.reasons.join(" ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
