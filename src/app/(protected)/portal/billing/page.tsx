import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, CreditCard } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { MetricCard } from "@/components/shared/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
import { getBillingAccount } from "@/server/services/billing-account-service";
import { getCurrentSubscriptionDetail } from "@/server/services/subscription-service";
import { getCreditBalance } from "@/server/services/credit-service";
import { formatMoney } from "@/lib/utils/money";
import { OpenPortalBillingPortalButton } from "./open-billing-portal-button";

export const metadata: Metadata = { title: "Billing" };

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

const BILLING_ACCOUNT_STATUS_TONE: Record<string, "success" | "warning" | "destructive"> = {
  ACTIVE: "success",
  PAST_DUE: "warning",
  SUSPENDED: "destructive",
  CLOSED: "destructive",
};

/**
 * Customer Portal billing (Build 26) — reuses the SAME organization-
 * scoped, already-`billing.read`-gated services `/organizations/[id]/
 * billing` uses (no duplicated billing formulas, no direct Stripe
 * calls from this page). See customer-portal.md "Invoices"/"Payments."
 */
export default async function PortalBillingPage() {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Billing" />;

  if (!guard.authorization.permissions.has("billing.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Billing" breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "Billing" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing billing requires the billing.read permission." />
      </div>
    );
  }

  const organizationId = guard.organizationId;
  const [account, subscriptionDetail, credit] = await Promise.all([
    getBillingAccount({ organizationId }),
    getCurrentSubscriptionDetail({ organizationId }),
    getCreditBalance({ organizationId }),
  ]);

  const canManage = guard.authorization.permissions.has("billing.manage");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Billing"
        description="Your plan, subscription, and payment method with Alpha Page Rankers."
        breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "Billing" }]}
        actions={canManage ? <OpenPortalBillingPortalButton organizationId={organizationId} disabled={!account} /> : undefined}
      />

      {!account ? (
        <EmptyState icon={CreditCard} title="No billing account yet" description="A billing account is created automatically on your first checkout." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <MetricCard label="Account status" value={account.status} icon={CreditCard} />
            <MetricCard label="Plan" value={subscriptionDetail.planName ?? "No active plan"} icon={CreditCard} />
            <MetricCard label="Credit balance" value={credit.currency ? formatMoney(credit.balance, credit.currency) : "—"} icon={CreditCard} />
          </div>

          <section className="flex flex-col gap-4">
            <SectionHeader title="Account" />
            <Card>
              <CardContent className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Billing account status</span>
                <StatusBadge status={BILLING_ACCOUNT_STATUS_TONE[account.status] ?? "neutral"}>{account.status}</StatusBadge>
              </CardContent>
            </Card>
          </section>

          <section className="flex flex-col gap-4">
            <SectionHeader title="Subscription" />
            {!subscriptionDetail.subscription ? (
              <EmptyState icon={CreditCard} title="No active subscription" />
            ) : (
              <Card>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{subscriptionDetail.planName ?? "Plan"}</span>
                    <StatusBadge status={SUBSCRIPTION_STATUS_TONE[subscriptionDetail.subscription.status] ?? "neutral"}>{subscriptionDetail.subscription.status}</StatusBadge>
                  </div>
                  {subscriptionDetail.unitAmount !== null && subscriptionDetail.currency ? (
                    <span className="text-sm text-muted-foreground">
                      {formatMoney(subscriptionDetail.unitAmount, subscriptionDetail.currency)} / {subscriptionDetail.interval?.toLowerCase()}
                    </span>
                  ) : null}
                </CardContent>
              </Card>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <SectionHeader title="Invoices & payments" />
            <div className="flex gap-3">
              <Button asChild variant="outline">
                <Link href="/portal/billing/invoices">View invoices</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/portal/billing/payments">View payments</Link>
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
