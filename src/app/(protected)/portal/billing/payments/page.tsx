import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, CreditCard } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { listPaymentsForOrganization } from "@/server/services/payment-service";
import { formatMoney } from "@/lib/utils/money";

export const metadata: Metadata = { title: "Payments" };

const PAYMENT_STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "neutral"> = {
  SUCCEEDED: "success",
  PENDING: "warning",
  FAILED: "destructive",
  REFUNDED: "neutral",
  PARTIALLY_REFUNDED: "neutral",
};

/**
 * Read-only payment history (Build 26) — no customer-initiated payment
 * action here (see customer-portal.md "Payments" — Alpha OS never
 * builds a second checkout flow). "Manage payment method" lives on the
 * main Billing page, via the existing Stripe billing portal.
 */
export default async function PortalPaymentsPage({ searchParams }: PageProps<"/portal/billing/payments">) {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Payments" />;

  if (!guard.authorization.permissions.has("billing.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Payments" breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "Billing", href: "/portal/billing" }, { label: "Payments" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing payments requires the billing.read permission." />
      </div>
    );
  }

  const sp = await searchParams;
  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const cursor = single(sp.cursor);

  const page = await listPaymentsForOrganization({ organizationId: guard.organizationId, cursor, limit: 25 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Payments" breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "Billing", href: "/portal/billing" }, { label: "Payments" }]} />

      {page.items.length === 0 ? (
        <EmptyState icon={CreditCard} title="No payments yet" />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {page.items.map((payment) => (
              <Card key={payment.id}>
                <CardContent className="flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{formatMoney(payment.amount, payment.currency)}</span>
                    <span className="text-xs text-muted-foreground">
                      {payment.paymentMethodBrand ? `${payment.paymentMethodBrand} •••• ${payment.paymentMethodLast4}` : payment.paymentMethodType ?? "—"}
                      {payment.paidAt ? ` — ${new Date(payment.paidAt).toLocaleDateString()}` : ""}
                    </span>
                    {payment.status === "FAILED" && payment.failureMessage ? <span className="text-xs text-destructive">{payment.failureMessage}</span> : null}
                  </div>
                  <StatusBadge status={PAYMENT_STATUS_TONE[payment.status] ?? "neutral"}>{payment.status.replace(/_/g, " ")}</StatusBadge>
                </CardContent>
              </Card>
            ))}
          </div>
          {page.pageInfo.hasNextPage && page.pageInfo.nextCursor ? (
            <Button asChild variant="outline" className="w-fit">
              <Link href={`/portal/billing/payments?cursor=${page.pageInfo.nextCursor}`}>Next page</Link>
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
