import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, CheckCircle2, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { MetricCard } from "@/components/shared/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getControlCenterReport } from "@/server/services/billing-diagnostics-service";
import { MetricInfo } from "../metric-info";

export const metadata: Metadata = { title: "Billing controls" };

const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

/**
 * The billing operational control center (spec §16/§17) —
 * `billing.controls.read`. Primarily DIAGNOSTIC — this page reads and
 * reports, it never mutates. See `billing-diagnostics-service.ts`'s own
 * top comment for why this deliberately does NOT run a live per-
 * organization Stripe reconciliation sweep; the per-organization
 * on-demand reconciliation check (Module 14, still there) is the deeper
 * dive this page links out to instead.
 */
export default async function AdminBillingControlsPage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("billing.controls.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Billing controls" breadcrumbs={[{ label: "Billing", href: "/admin/billing" }, { label: "Controls" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing billing controls requires the billing.controls.read permission." />
      </div>
    );
  }

  const report = await getControlCenterReport();
  const allAnomalies = [
    ...report.webhookHealth.staleAnomalies,
    ...report.consistency.invoiceBalanceAnomalies,
    ...report.consistency.refundAnomalies,
    ...report.consistency.creditBalanceAnomalies,
    ...report.consistency.creditRelationAnomalies,
    ...report.consistency.subscriptionStateAnomalies,
    ...report.consistency.duplicatePaymentAnomalies,
  ].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Billing controls"
        description="Operational diagnostics — reconciliation/webhook health and deterministic data-consistency checks. Read-only; nothing here mutates financial records."
        breadcrumbs={[{ label: "Billing", href: "/admin/billing" }, { label: "Controls" }]}
      />

      <section className="flex flex-col gap-4">
        <SectionHeader title="Provider synchronization" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <MetricCard
            label="Stripe configured"
            value={report.providerConnectivity.configured ? "Yes" : "No"}
            info={<MetricInfo definition="Whether a Stripe secret key is configured in this environment at all — a zero-cost local check, not a live API call." />}
          />
          <MetricCard
            label="Last webhook received"
            value={report.webhookHealth.mostRecentEventAt ? report.webhookHealth.mostRecentEventAt.toLocaleString() : "Never"}
            info={<MetricInfo definition="The most recent BillingWebhookEvent of any status/type — a local proxy for 'is Stripe actually reaching us,' without an extra live API call." />}
          />
          <MetricCard label="Pending" value={String(report.webhookHealth.countsByStatus.PENDING)} />
          <MetricCard label="Failed" value={String(report.webhookHealth.countsByStatus.FAILED)} trend={report.webhookHealth.countsByStatus.FAILED > 0 ? "down" : "neutral"} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Anomalies" description={`${report.totalAnomalyCount} found — deterministic rules only, never AI/probabilistic scoring. See docs/architecture/financial-controls.md for every rule's exact definition.`} />
        {allAnomalies.length === 0 ? (
          <Alert>
            <CheckCircle2 />
            <AlertDescription>No anomalies detected.</AlertDescription>
          </Alert>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Severity</TableHead><TableHead>Rule</TableHead><TableHead>Organization</TableHead><TableHead>Description</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {allAnomalies.map((anomaly, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <span className={anomaly.severity === "HIGH" ? "text-destructive" : anomaly.severity === "MEDIUM" ? "text-warning" : "text-muted-foreground"}>
                        {anomaly.severity === "HIGH" ? <AlertTriangle className="inline size-3.5" aria-hidden="true" /> : null} {anomaly.severity}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{anomaly.rule}</TableCell>
                    <TableCell>
                      {anomaly.organizationId ? (
                        <Link href={`/admin/billing/organizations/${anomaly.organizationId}`} className="text-link hover:underline">
                          View organization
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{anomaly.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Deeper investigation" description="For a specific organization's own Alpha-OS-vs-Stripe divergence, use its own reconciliation check." />
        <Card className="max-w-xl">
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Open an organization&apos;s own billing detail page (via the Anomalies table above, or the{" "}
              <Link href="/admin/billing/organizations" className="text-link underline underline-offset-4">organizations directory</Link>) and use its &ldquo;Run reconciliation check&rdquo; button.
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
