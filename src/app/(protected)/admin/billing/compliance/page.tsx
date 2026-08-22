import type { Metadata } from "next";
import { ShieldAlert, Landmark, Receipt } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { MetricCard } from "@/components/shared/metric-card";
import { AreaChart, type ChartConfig } from "@/components/shared/charts";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getDeferredRevenueSummary, getPlatformRecognitionTrend } from "@/server/services/revenue-recognition-service";
import { getPlatformTaxComplianceReport } from "@/server/services/tax-compliance-service";
import { formatMoney } from "@/lib/utils/money";
import { MetricInfo } from "../metric-info";

export const metadata: Metadata = { title: "Billing compliance" };

/**
 * Revenue recognition & tax compliance (Module 16) —
 * `billing.compliance.read`, PLATFORM-ONLY (see `revenue-recognition.md`
 * "Why this is platform-only, not organization-facing"). Every figure
 * here derives from real Stripe data (`InvoiceLineItem.servicePeriodStart/
 * End`, `InvoiceLineItemTax`) captured since this module — never a tax
 * calculation, never a filing capability. See `tax-compliance.md` "What
 * this does NOT claim to be."
 */
export default async function AdminBillingCompliancePage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("billing.compliance.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Billing compliance" breadcrumbs={[{ label: "Billing", href: "/admin/billing" }, { label: "Compliance" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing revenue recognition and tax compliance requires the billing.compliance.read permission." />
      </div>
    );
  }

  const [deferred, trend, tax] = await Promise.all([
    getDeferredRevenueSummary(),
    getPlatformRecognitionTrend({ period: "current_year", buckets: 12 }),
    getPlatformTaxComplianceReport({ period: "current_month" }),
  ]);

  const trendCurrencies = Array.from(new Set(trend.points.flatMap((p) => p.byCurrency.map((c) => c.currency)))).sort();
  const trendChartData = trend.points.map((point) => {
    const row: Record<string, unknown> = { label: point.bucketStart.toLocaleDateString("en-US", { month: "short" }) };
    for (const currency of trendCurrencies) row[currency] = (point.byCurrency.find((c) => c.currency === currency)?.amount ?? 0) / 100;
    return row;
  });
  const trendChartConfig: ChartConfig = Object.fromEntries(trendCurrencies.map((currency, i) => [currency, { label: `Recognized (${currency})`, color: `var(--chart-${(i % 5) + 1})` }]));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Revenue recognition & tax compliance"
        description="Deferred/recognized revenue and tax collected — derived from real billing records, never a tax calculation or GAAP-certified accounting system. See each metric's info icon for its exact definition."
        breadcrumbs={[{ label: "Billing", href: "/admin/billing" }, { label: "Compliance" }]}
      />

      {/* --- Deferred revenue -------------------------------------------- */}
      <section className="flex flex-col gap-4">
        <SectionHeader title="Deferred revenue" description="A point-in-time balance, as of now — the portion of billed subscription revenue not yet earned." />
        {deferred.totals.length === 0 ? (
          <EmptyState title="No deferred revenue" description="No PAID or OPEN invoice line item currently has an unexpired service period." />
        ) : (
          deferred.totals.map((row) => (
            <div key={row.currency} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MetricCard
                label={`Total billed (${row.currency})`}
                value={formatMoney(row.totalBilled, row.currency)}
                icon={Landmark}
                info={<MetricInfo definition="The full amount of every PAID/OPEN invoice line item whose service period has not yet fully elapsed — the base this section's recognized/deferred split divides." />}
              />
              <MetricCard
                label={`Recognized (${row.currency})`}
                value={formatMoney(row.recognized, row.currency)}
                info={<MetricInfo definition="Ratably (straight-line) earned as of now, based on each line item's own real service period. Not cash collected — see revenue-metrics.md's own billed-vs-collected distinction." />}
              />
              <MetricCard
                label={`Deferred (${row.currency})`}
                value={formatMoney(row.deferred, row.currency)}
                icon={Receipt}
                info={<MetricInfo definition="Billed but not yet earned — a real deferred-revenue liability figure. total_billed - recognized, always." />}
              />
            </div>
          ))
        )}
      </section>

      {/* --- Recognition trend -------------------------------------------- */}
      {trendCurrencies.length > 0 ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Revenue recognized over time" description="Current year, monthly buckets — how much revenue was earned during each month, not billed during it." />
          <Card>
            <CardContent>
              <AreaChart data={trendChartData} config={trendChartConfig} xKey="label" seriesKeys={trendCurrencies} className="h-64 w-full" />
            </CardContent>
          </Card>
          {/* Accessible data-table equivalent of the chart above */}
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  {trendCurrencies.map((currency) => <TableHead key={currency} className="text-right">{currency}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {trend.points.map((point, i) => (
                  <TableRow key={i}>
                    <TableCell>{point.bucketStart.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</TableCell>
                    {trendCurrencies.map((currency) => (
                      <TableCell key={currency} className="text-right tabular-nums">{formatMoney(point.byCurrency.find((c) => c.currency === currency)?.amount ?? 0, currency)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      {/* --- Tax collected -------------------------------------------- */}
      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Tax collected this month"
          description="Real tax amounts the payment provider already calculated and charged — Alpha OS calculates no tax of its own. Grouped by the provider's own tax rate reference, never resolved to a jurisdiction name."
        />
        {tax.totalsByCurrency.length === 0 ? (
          <EmptyState title="No tax collected this month" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {tax.totalsByCurrency.map((row) => (
                <MetricCard
                  key={row.currency}
                  label={`Tax collected (${row.currency})`}
                  value={formatMoney(row.amount, row.currency)}
                  info={<MetricInfo definition="The sum of every InvoiceLineItemTax component on a non-DRAFT invoice issued this month — real amounts the provider calculated, reported here as-is." />}
                />
              ))}
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Currency</TableHead><TableHead>Taxability reason</TableHead><TableHead>Provider tax rate ref.</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Components</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {tax.breakdown.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell>{row.currency}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.taxabilityReason}</TableCell>
                      <TableCell className="font-mono text-xs">{row.providerTaxRateId}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(row.amount, row.currency)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.componentCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
