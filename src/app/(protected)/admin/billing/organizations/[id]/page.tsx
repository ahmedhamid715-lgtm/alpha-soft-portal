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
import { organizationRepository } from "@/server/repositories/organization-repository";
import { formatMoney } from "@/lib/utils/money";
import { BillingAccountInvalidError } from "@/lib/billing/errors";
import { RefundButton } from "./refund-button";

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

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={organization.displayName} description="Billing" breadcrumbs={[{ label: "Billing", href: "/admin/billing" }, { label: organization.displayName }]} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Billing account</span>
            <StatusBadge status={ACCOUNT_STATUS_TONE[detail.billingAccount.status] ?? "neutral"}>{detail.billingAccount.status}</StatusBadge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Subscription</span>
            {detail.subscription ? <StatusBadge status={SUBSCRIPTION_STATUS_TONE[detail.subscription.status] ?? "neutral"}>{detail.subscription.status}</StatusBadge> : <span className="text-sm">None</span>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Currency</span>
            <span className="font-medium">{detail.billingAccount.currency}</span>
          </CardContent>
        </Card>
      </div>

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
    </div>
  );
}
