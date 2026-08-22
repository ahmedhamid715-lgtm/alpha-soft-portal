import type { BillingAccountStatus, SubscriptionStatus } from "@/generated/prisma/client";

/**
 * Billing health (spec §12) — a clear, DERIVED operational status,
 * never a second, independently-writable field. `BillingHealth` is
 * computed fresh from `BillingAccount.status` + the current
 * `Subscription.status`/`cancelAtPeriodEnd` on every read
 * (`computeBillingHealth()`) — there is no `Organization.billingHealth`
 * column anywhere in the schema, deliberately: a cached, independently-
 * mutable copy of a derived value is exactly the "unnecessary
 * denormalized state" spec §11's own credit-balance reasoning already
 * warns against, applied here to health instead of money.
 *
 * Drives customer UI, admin UI, and notification-worthiness decisions
 * (see `subscribers.ts`'s own selective-notification filter) — never a
 * second entitlement system (spec §12's own explicit boundary: "do not
 * implement the full entitlement system in this module").
 */
export type BillingHealth = "healthy" | "trial" | "payment_due" | "payment_failed" | "past_due" | "suspended" | "canceled" | "no_subscription";

export function computeBillingHealth(
  billingAccountStatus: BillingAccountStatus | null,
  subscription: { status: SubscriptionStatus; cancelAtPeriodEnd: boolean } | null,
): BillingHealth {
  // The billing account's own administrative hold always wins — a
  // platform-suspended account is "suspended" regardless of what the
  // underlying subscription happens to say (spec's own "suspended
  // organization" adversarial scenario needs a status that reflects
  // the ADMINISTRATIVE fact, not just the payment-lifecycle fact).
  if (billingAccountStatus === "SUSPENDED") return "suspended";
  if (billingAccountStatus === "CLOSED") return "canceled";

  if (!subscription) return "no_subscription";

  switch (subscription.status) {
    case "TRIALING":
      return "trial";
    case "ACTIVE":
      // A scheduled cancellation is still "healthy" — the customer is
      // fully served until the period actually ends; only the
      // subscription-detail UI needs to know `cancelAtPeriodEnd`
      // specifically (see `describeLifecycleState()`), not the
      // coarser health signal this function produces.
      return "healthy";
    case "PAST_DUE":
      // A previously-active subscription now behind on a RENEWAL
      // payment — distinct from `INCOMPLETE` below (the FIRST payment
      // never completed at all).
      return "past_due";
    case "UNPAID":
      return "payment_failed";
    case "CANCELED":
    case "INCOMPLETE_EXPIRED":
      return "canceled";
    case "PAUSED":
      return "suspended";
    case "INCOMPLETE":
      return "payment_due";
    default:
      return "no_subscription";
  }
}

export const BILLING_HEALTH_LABELS: Record<BillingHealth, string> = {
  healthy: "Healthy",
  trial: "Trial",
  payment_due: "Payment due",
  payment_failed: "Payment failed",
  past_due: "Past due",
  suspended: "Suspended",
  canceled: "Canceled",
  no_subscription: "No subscription",
};

export const BILLING_HEALTH_TONE: Record<BillingHealth, "success" | "warning" | "destructive" | "info" | "neutral"> = {
  healthy: "success",
  trial: "info",
  payment_due: "warning",
  payment_failed: "destructive",
  past_due: "warning",
  suspended: "destructive",
  canceled: "neutral",
  no_subscription: "neutral",
};
