import "server-only";
import type Stripe from "stripe";
import type { SubscriptionStatus, InvoiceStatus, PaymentStatus, RefundStatus } from "@/generated/prisma/client";

/**
 * Stripe object/enum → Alpha OS domain mapping — the ONE place a Stripe
 * status string becomes an Alpha OS `SubscriptionStatus`/`InvoiceStatus`/
 * etc. (spec §8: "Do not blindly mirror provider enums"). Every function
 * here is pure and total (a `default` branch exists everywhere Stripe's
 * own union is wider than what's mapped, so an unrecognized future
 * Stripe value never throws mid-webhook-processing — see
 * billing-webhooks.md "Unknown provider values fail safe, not loud").
 */

/** Stripe's own subscription status vocabulary is unusually close to a real Alpha OS domain need, so this mapping is a faithful passthrough, not a lossy compression — see schema.prisma's own `SubscriptionStatus` doc comment for that reasoning. */
export function mapStripeSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "paused":
      return "PAUSED";
    case "canceled":
      return "CANCELED";
    case "incomplete":
      return "INCOMPLETE";
    case "incomplete_expired":
      return "INCOMPLETE_EXPIRED";
    case "unpaid":
      return "UNPAID";
    default:
      // Stripe's own `Status` type includes a forward-compat `OtherString`
      // branded type specifically so its SDK never blocks on a future
      // status value it doesn't know about yet — which also means this
      // `switch` can never be compile-time-exhaustive. Fails safe to
      // `INCOMPLETE` (the "not usable yet" state) rather than throwing
      // mid-webhook-processing; see billing-webhooks.md "Unknown
      // provider values fail safe, not loud."
      return "INCOMPLETE";
  }
}

export function mapStripeInvoiceStatus(status: Stripe.Invoice.Status | null): InvoiceStatus {
  switch (status) {
    case "draft":
      return "DRAFT";
    case "open":
      return "OPEN";
    case "paid":
      return "PAID";
    case "void":
      return "VOID";
    case "uncollectible":
      return "UNCOLLECTIBLE";
    case null:
    default:
      return "DRAFT";
  }
}

/** Alpha OS's `PaymentStatus` is derived from a Stripe PaymentIntent's status, not passed through 1:1 — Stripe's own vocabulary describes checkout-flow steps ("requires_action," "requires_confirmation") that have no Alpha OS-domain meaning once a payment has actually settled or failed. */
export function mapStripePaymentIntentStatus(status: Stripe.PaymentIntent.Status): PaymentStatus {
  switch (status) {
    case "succeeded":
      return "SUCCEEDED";
    case "canceled":
      return "FAILED";
    case "processing":
    case "requires_action":
    case "requires_capture":
    case "requires_confirmation":
    case "requires_payment_method":
      return "PENDING";
    default:
      // Same forward-compat `OtherString` reasoning as
      // `mapStripeSubscriptionStatus` above.
      return "PENDING";
  }
}

/** Stripe's `Refund.status` is a bare `string | null`, not a closed SDK enum — matched by value rather than a `switch` type. */
export function mapStripeRefundStatus(status: string | null | undefined): RefundStatus {
  if (status === "succeeded") return "SUCCEEDED";
  if (status === "failed") return "FAILED";
  if (status === "canceled") return "CANCELED";
  return "PENDING";
}

/**
 * The current billing period — Stripe's 2025-03-31 API version moved
 * `current_period_start`/`current_period_end` from the Subscription
 * itself onto each `SubscriptionItem` (to support items with
 * independent billing cycles). Alpha OS's own `Subscription` model
 * keeps ONE top-level period (spec §8's own suggested shape), derived
 * here from the FIRST item — a deliberate simplification matching this
 * module's single-item-subscription scope (spec §9 documents
 * `SubscriptionItem` existing so a FUTURE module can add true
 * multi-item/seat billing; this module doesn't need per-item period
 * tracking yet). `null` only if the subscription genuinely has no items
 * (shouldn't happen for a real Stripe subscription, but never assume).
 */
export function extractStripeCurrentPeriod(subscription: Stripe.Subscription): { start: Date | null; end: Date | null } {
  const firstItem = subscription.items.data[0];
  if (!firstItem) return { start: null, end: null };
  return {
    start: new Date(firstItem.current_period_start * 1000),
    end: new Date(firstItem.current_period_end * 1000),
  };
}

/** `Stripe.Subscription.items` → the `providerItemId`/`providerPriceId`/`quantity` triples `billing-webhook-service.ts` reconciles against `SubscriptionItem` rows. */
export function extractStripeSubscriptionItems(
  subscription: Stripe.Subscription,
): Array<{ providerItemId: string; providerPriceId: string; quantity: number }> {
  return subscription.items.data.map((item) => ({
    providerItemId: item.id,
    providerPriceId: typeof item.price === "string" ? item.price : item.price.id,
    quantity: item.quantity ?? 1,
  }));
}

/** Safe, display-only payment-method fields (spec §12/§38) — never anything beyond what Stripe already treats as non-sensitive. */
export function extractStripePaymentMethodDisplay(charge: Stripe.Charge | null | undefined): {
  paymentMethodType: string | null;
  paymentMethodBrand: string | null;
  paymentMethodLast4: string | null;
} {
  const card = charge?.payment_method_details?.card;
  return {
    paymentMethodType: charge?.payment_method_details?.type ?? null,
    paymentMethodBrand: card?.brand ?? null,
    paymentMethodLast4: card?.last4 ?? null,
  };
}
