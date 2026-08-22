import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ShieldAlert, CreditCard } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { MetricCard } from "@/components/shared/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { resolveOrganizationContext } from "@/lib/authorization/context";
import { getBillingAccount } from "@/server/services/billing-account-service";
import { getCurrentSubscriptionDetail } from "@/server/services/subscription-service";
import { listActivePlans } from "@/server/services/plan-service";
import { formatMoney } from "@/lib/utils/money";
import { PlanPicker } from "./plan-picker";
import { SubscriptionControls } from "./subscription-controls";
import { OpenBillingPortalButton } from "./open-billing-portal-button";

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
 * The customer billing dashboard (spec §25/§40) — answers, immediately:
 * what plan, how much, when charged next, is the payment method
 * healthy. `id` is a client-supplied route param, never trusted
 * directly — `resolveOrganizationContext(id)` (and every service
 * function called below, independently) is what actually decides
 * access; a member without `billing.read` sees the same access-denied
 * state every other permission-gated page in this codebase renders.
 */
export default async function BillingPage({ params }: PageProps<"/organizations/[id]/billing">) {
  const { id } = await params;
  const context = await resolveOrganizationContext(id);

  if (!context.organizationId || context.organizationId !== id) {
    notFound();
  }

  if (!context.permissions.has("billing.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Billing" breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Billing" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing billing requires the billing.read permission." />
      </div>
    );
  }

  const canManage = context.permissions.has("billing.manage");

  const [billingAccount, subscriptionDetail] = await Promise.all([
    getBillingAccount({ organizationId: id }),
    getCurrentSubscriptionDetail({ organizationId: id }),
  ]);

  const { subscription, planName, unitAmount, currency, interval } = subscriptionDetail;
  const hasActiveSubscription = subscription && subscription.status !== "CANCELED" && subscription.status !== "INCOMPLETE_EXPIRED";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Billing"
        description="Your organization's plan, subscription, and payment status."
        breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Billing" }]}
      />

      {billingAccount && billingAccount.status !== "ACTIVE" ? (
        <Card className="border-destructive/30">
          <CardContent className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">
                Billing account {billingAccount.status === "PAST_DUE" ? "past due" : billingAccount.status.toLowerCase()}
              </p>
              <p className="text-sm text-muted-foreground">
                {billingAccount.status === "PAST_DUE"
                  ? "A recent payment failed. Update your payment method to avoid a service interruption."
                  : "Contact support if you believe this is unexpected."}
              </p>
            </div>
            <StatusBadge status={BILLING_ACCOUNT_STATUS_TONE[billingAccount.status] ?? "neutral"}>{billingAccount.status}</StatusBadge>
          </CardContent>
        </Card>
      ) : null}

      {hasActiveSubscription && subscription ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Current plan" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricCard label="Plan" value={planName ?? "—"} icon={CreditCard} />
            <MetricCard
              label="Amount"
              value={unitAmount !== null && currency ? `${formatMoney(unitAmount, currency)} / ${interval === "YEAR" ? "yr" : "mo"}` : "—"}
            />
            <MetricCard
              label="Renews"
              value={subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : "—"}
            />
          </div>

          <Card className="max-w-2xl">
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <StatusBadge status={SUBSCRIPTION_STATUS_TONE[subscription.status] ?? "neutral"}>{subscription.status}</StatusBadge>
              </div>
              {subscription.cancelAtPeriodEnd ? (
                <p className="text-sm text-warning">
                  This subscription is scheduled to cancel at the end of the current period.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                {canManage ? (
                  <>
                    <OpenBillingPortalButton organizationId={id} />
                    <SubscriptionControls organizationId={id} cancelAtPeriodEnd={subscription.cancelAtPeriodEnd} />
                  </>
                ) : null}
              </div>
              {!canManage ? <p className="text-xs text-muted-foreground">Changing your plan or payment method requires the organization owner.</p> : null}
            </CardContent>
          </Card>
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Choose a plan" description="No active subscription yet." />
          {canManage ? (
            <PlanPicker organizationId={id} plans={await listActivePlans({ organizationId: id })} />
          ) : (
            <EmptyState
              icon={CreditCard}
              title="No active subscription"
              description="Ask the organization owner to choose a plan."
            />
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <SectionHeader title="Invoices" />
        <Button asChild variant="outline" className="w-fit">
          <Link href={`/organizations/${id}/billing/invoices`}>View invoice history</Link>
        </Button>
      </section>
    </div>
  );
}
