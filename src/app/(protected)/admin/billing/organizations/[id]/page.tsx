import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getOrganizationBillingForPlatform } from "@/server/services/billing-platform-service";
import { getOrganizationMrrSummaryForPlatform } from "@/server/services/mrr-service";
import { getOrganizationAgingReportForPlatform } from "@/server/services/revenue-reporting-service";
import { getOrganizationFinancialHealthForPlatform } from "@/server/services/financial-health-service";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { formatMoney } from "@/lib/utils/money";
import { AGING_BUCKET_LABELS } from "@/lib/billing/reporting/aging";
import { FINANCIAL_HEALTH_LABELS, FINANCIAL_HEALTH_TONE } from "@/lib/billing/reporting/financial-health";
import { BillingAccountInvalidError } from "@/lib/billing/errors";
import { RefundButton } from "./refund-button";
import { CreditIssueForm } from "./credit-issue-form";
import { TrialExtendForm } from "./trial-extend-form";
import { ReconcileButton } from "./reconcile-button";
import { MetricInfo } from "../../metric-info";
import { MetricCard } from "@/components/shared/metric-card";

export const metadata: Metadata = { title: "Organization billing" };

const ACCOUNT_STATUS_TONE: Record<string, "success" | "warning" | "destructive"> = { ACTIVE: "success", PAST_DUE: "warning", SUSPENDED: "destructive", CLOSED: "destructive" };
const SUBSCRIPTION_STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "neutral" | "info"> = { ACTIVE: "success", TRIALING: "info", PAST_DUE: "warning", UNPAID: "destructive", PAUSED: "warning", CANCELED: "neutral", INCOMPLETE: "neutral", INCOMPLETE_EXPIRED: "destructive" };
const PAYMENT_STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "neutral"> = { SUCCEEDED: "success", PENDING: "warning", FAILED: "destructive", REFUNDED: "neutral", PARTIALLY_REFUNDED: "neutral" };

/**
 * One organization's billing, from the platform's own view (spec §24) —
 * `billing.readPlatform`. Deliberately narrow: subscription status and
 * a bounded recent-invoice/payment summary — never a payment-method
 * number, never a raw Stripe payload (see billing-security.md). Refund
 * is the ONE mutation available here, and only for a caller who also
 * holds `billing.refund` (platform_owner) — `RefundButton` simply isn't
 * rendered otherwise; the real enforcement is `issueRefund()`'s own
 * server-side permission check.
 */
export default async function AdminOrganizationBillingPage({ params }: PageProps<"/admin/billing/organizations/[id]">) {
  const { id } = await params;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("billing.readPlatform")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Organization billing" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing platform billing requires the billing.readPlatform permission." />
      </div>
    );
  }

  const organization = await organizationRepository.findById(id);
  if (!organization) notFound();

  let detail;
  try {
    detail = await getOrganizationBillingForPlatform({ organizationId: id });
  } catch (error) {
    if (error instanceof BillingAccountInvalidError) {
      return (
        <div className="flex flex-col gap-6">
          <PageHeader title={organization.displayName} description="Billing" breadcrumbs={[{ label: "Billing", href: "/admin/billing" }, { label: organization.displayName }]} />
          <EmptyState title="No billing account" description="This organization has not started billing yet." />
        </div>
      );
    }
    throw error;
  }

  const canRefund = context.permissions.has("billing.refund");
  const canManageCredit = context.permissions.has("billing.credit.manage");

  const [mrr, aging, health] = await Promise.all([
    getOrganizationMrrSummaryForPlatform({ organizationId: id }),
    getOrganizationAgingReportForPlatform({ organizationId: id }),
    getOrganizationFinancialHealthForPlatform({ organizationId: id }),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={organization.displayName} description="Billing" breadcrumbs={[{ label: "Billing", href: "/admin/billing" }, { label: organization.displayName }]} />

      <section className="flex flex-col gap-4">
        <SectionHeader title="Financial health" description="A transparent, deterministic classification — every result names its exact reasons, never a black-box score." />
        <Card className="max-w-2xl">
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <StatusBadge status={FINANCIAL_HEALTH_TONE[health.classification]}>{FINANCIAL_HEALTH_LABELS[health.classification]}</StatusBadge>
            </div>
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {health.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
            </ul>
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Recurring revenue" />
        {mrr.byCurrency.length === 0 ? (
          <EmptyState title="No recurring revenue" description="No ACTIVE or PAST_DUE subscription." />
        ) : (
          mrr.byCurrency.map((row) => (
            <div key={row.currency} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <MetricCard
                label={`MRR (${row.currency})`}
                value={formatMoney(row.mrr, row.currency)}
                info={<MetricInfo definition="Monthly Recurring Revenue from this organization's current ACTIVE/PAST_DUE subscription(s)." />}
              />
              <MetricCard label={`ARR (${row.currency})`} value={formatMoney(row.arr, row.currency)} info={<MetricInfo definition="MRR × 12." />} />
            </div>
          ))
        )}
      </section>

      {aging.totalOutstandingByCurrency.length > 0 ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Accounts receivable aging" />
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
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Billing account</span>
            <StatusBadge status={ACCOUNT_STATUS_TONE[detail.billingAccount.status] ?? "neutral"}>{detail.billingAccount.status}</StatusBadge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Subscription</span>
            {detail.subscription ? (
              <div className="flex items-center gap-2">
                <StatusBadge status={SUBSCRIPTION_STATUS_TONE[detail.subscription.status] ?? "neutral"}>{detail.subscription.status}</StatusBadge>
                {detail.subscription.cancelAtPeriodEnd ? <span className="text-xs text-warning">ends {detail.subscription.currentPeriodEnd ? new Date(detail.subscription.currentPeriodEnd).toLocaleDateString() : "soon"}</span> : null}
              </div>
            ) : (
              <span className="text-sm">None</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Currency</span>
            <span className="font-medium">{detail.billingAccount.currency}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Credit balance</span>
            <span className="font-medium">{formatMoney(detail.creditBalance, detail.billingAccount.currency)}</span>
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Reconciliation" description="Compares Alpha OS's own subscription record against Stripe's live state." />
        <ReconcileButton organizationId={id} />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Recent invoices" description="Most recent 10." />
        {detail.recentInvoices.length === 0 ? (
          <EmptyState title="No invoices" />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Invoice</TableHead><TableHead>Issued</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {detail.recentInvoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell>{invoice.invoiceNumber}</TableCell>
                    <TableCell>{new Date(invoice.issueDate).toLocaleDateString()}</TableCell>
                    <TableCell><StatusBadge status={invoice.status === "PAID" ? "success" : invoice.status === "UNCOLLECTIBLE" ? "destructive" : "neutral"}>{invoice.status}</StatusBadge></TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(invoice.total, invoice.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Recent payments" description="Most recent 10. Never shows raw payment credentials — provider references and safe display fields only." />
        {detail.recentPayments.length === 0 ? (
          <EmptyState title="No payments" />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Payment</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead>{canRefund ? <TableHead><span className="sr-only">Actions</span></TableHead> : null}</TableRow>
              </TableHeader>
              <TableBody>
                {detail.recentPayments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-mono text-xs">{payment.providerPaymentId}</TableCell>
                    <TableCell>{payment.paymentMethodBrand ? `${payment.paymentMethodBrand} •••• ${payment.paymentMethodLast4}` : "—"}</TableCell>
                    <TableCell><StatusBadge status={PAYMENT_STATUS_TONE[payment.status] ?? "neutral"}>{payment.status}</StatusBadge></TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(payment.amount, payment.currency)}</TableCell>
                    {canRefund ? (
                      <TableCell>
                        {payment.status === "SUCCEEDED" || payment.status === "PARTIALLY_REFUNDED" ? (
                          <RefundButton organizationId={id} paymentId={payment.id} amount={payment.amount} currency={payment.currency} />
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {canManageCredit ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Credit" description="Applied automatically to the customer's next invoice. Reversible — never a delete, only an offsetting compensating entry." />
          <Card className="max-w-xl">
            <CardContent className="flex flex-col gap-4">
              <CreditIssueForm organizationId={id} currency={detail.billingAccount.currency} />
              {detail.recentCreditEntries.length > 0 ? (
                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <span className="text-sm text-muted-foreground">Recent activity</span>
                  {detail.recentCreditEntries.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between text-sm">
                      <span>{entry.reason}</span>
                      <span className={entry.type === "CREDIT" ? "text-success tabular-nums" : "text-muted-foreground tabular-nums"}>
                        {entry.type === "CREDIT" ? "+" : "−"}
                        {formatMoney(entry.amount, entry.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {canManageCredit && detail.subscription?.status === "TRIALING" ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Trial" description="Extends the current trial period. Only available while the subscription is trialing." />
          <Card className="max-w-xl">
            <CardContent>
              <TrialExtendForm organizationId={id} />
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
