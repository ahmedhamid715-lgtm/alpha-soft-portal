/**
 * Provider-agnostic input/output shapes (spec §15) — every one of these
 * is expressed purely in Alpha OS domain terms (internal ids, minor-unit
 * amounts, ISO currency codes). `stripe/provider.ts` is the ONLY file
 * that translates between these and actual Stripe SDK objects
 * (`stripe/mapper.ts`) — nothing else in the codebase should import
 * `stripe` at all. See `interface.ts` for the adapter contract these
 * types serve.
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
