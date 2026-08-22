import type { SubscriptionStatus } from "@/generated/prisma/client";

/**
 * Provider-agnostic input/output shapes (spec §15) — every one of these
 * is expressed purely in Alpha OS domain terms (internal ids, minor-unit
 * amounts, ISO currency codes). `stripe/provider.ts` is the ONLY file
 * that translates between these and actual Stripe SDK objects
 * (`stripe/mapper.ts`) — nothing else in the codebase should import
 * `stripe` at all. See `interface.ts` for the adapter contract these
 * types serve. `SubscriptionStatus` itself is Alpha OS's own domain
 * enum (schema.prisma), not a Stripe type — referencing it here is what
 * lets `GetSubscriptionResult` return an ALREADY-MAPPED status (via
 * `stripe/mapper.ts`'s existing `mapStripeSubscriptionStatus()`) rather
 * than making every caller outside the provider boundary re-implement
 * that mapping itself (spec §36: Stripe-specific types stay inside the
 * provider implementation boundary — a raw Stripe status string
 * leaking into `billing-reconciliation-service.ts` would violate that
 * exactly as much as a raw `Stripe.Subscription` object would).
 */

export interface CreateProviderCustomerInput {
  organizationId: string;
  /** Organization's own contact email, if known — purely informational on the provider side, never used for auth. */
  email: string | null;
  /** Display name shown in the provider's own dashboard — never used for anything Alpha OS itself reads back. */
  name: string;
}

export interface CreateProviderCustomerResult {
  providerCustomerId: string;
}

export interface CreateCheckoutSessionInput {
  organizationId: string;
  providerCustomerId: string;
  /** The internal `PlanPrice.id` the customer is subscribing to — the provider adapter resolves this to the actual provider price id itself; a caller never passes a provider id directly (spec §26/§43). */
  planPriceId: string;
  providerPriceId: string;
  quantity: number;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateCheckoutSessionResult {
  url: string;
}

export interface CreateBillingPortalSessionInput {
  organizationId: string;
  providerCustomerId: string;
  returnUrl: string;
}

export interface CreateBillingPortalSessionResult {
  url: string;
}

export interface CancelSubscriptionInput {
  providerSubscriptionId: string;
  /** `true`: mark cancel-at-period-end (the default, reversible path — spec §28). `false`: cancel immediately. */
  atPeriodEnd: boolean;
}

export interface ResumeSubscriptionInput {
  providerSubscriptionId: string;
}

export interface IssueRefundInput {
  providerPaymentId: string;
  /** Minor units. Omit for a full refund. */
  amount?: number;
  reason?: string;
}

export interface IssueRefundResult {
  providerRefundId: string;
  status: string;
}

/**
 * Module 14 — in-place plan change (spec §5/§35's own
 * `previewSubscriptionChange()`/`changeSubscription()` naming). The
 * caller resolves `providerItemId`/`providerPriceId` from its own
 * catalog/subscription rows first — this input carries only what the
 * provider actually needs to perform the swap, never a bare price
 * string the caller invented.
 */
export interface ChangeSubscriptionInput {
  providerSubscriptionId: string;
  /** The Stripe subscription ITEM being changed — required so the adapter updates the existing item in place rather than adding a second one. */
  providerItemId: string;
  providerPriceId: string;
  quantity: number;
}

export interface PreviewSubscriptionChangeResult {
  /** `false` when the provider genuinely cannot produce a preview (spec §5: "where the provider cannot guarantee a preview, explicitly indicate that") — the UI must show an honest "not available" state, never a fabricated number. */
  available: boolean;
  currency: string;
  /** What would be charged/credited immediately if this change were applied now (negative = a credit toward the next invoice, positive = an immediate charge). Minor units. */
  immediateChangeAmount: number;
  /** The total of the resulting invoice this preview describes. Minor units. */
  totalAmount: number;
  /** Unix-seconds boundary the preview's proration was calculated against. */
  effectiveAt: number;
}

export interface GetSubscriptionResult {
  providerSubscriptionId: string;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
}

export interface ExtendTrialInput {
  providerSubscriptionId: string;
  /** Unix seconds — the NEW trial end. Validated by the caller (`credit-service.ts`) to be strictly after the current trial end before this is ever invoked. */
  newTrialEndUnixSeconds: number;
}

export interface RetryInvoicePaymentInput {
  providerInvoiceId: string;
}
