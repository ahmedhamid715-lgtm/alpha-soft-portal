import type {
  CancelSubscriptionInput,
  CreateBillingPortalSessionInput,
  CreateBillingPortalSessionResult,
  CreateCheckoutSessionInput,
  CreateCheckoutSessionResult,
  CreateProviderCustomerInput,
  CreateProviderCustomerResult,
  IssueRefundInput,
  IssueRefundResult,
  ResumeSubscriptionInput,
} from "./types";

/**
 * The provider abstraction (spec §15) — the one boundary Alpha OS's
 * billing domain is allowed to depend on. `stripe/provider.ts` is the
 * only implementation today; adding a second provider means writing a
 * new class against this same interface, never touching a service or a
 * repository (spec's own architecture diagram: `Billing Services →
 * Provider Abstraction → Stripe Provider → Stripe API`).
 *
 * Every method is provider-agnostic in and out — see `types.ts`. A
 * method that would need to leak a Stripe-specific type (e.g. handing a
 * raw `Stripe.Subscription` back to a service) doesn't belong here; the
 * webhook processor, not this interface, is where provider state
 * becomes Alpha OS state (see `stripe/webhook.ts`, `billing-webhook-
 * service.ts`).
 */
export interface BillingProviderAdapter {
  createCustomer(input: CreateProviderCustomerInput): Promise<CreateProviderCustomerResult>;
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CreateCheckoutSessionResult>;
  createBillingPortalSession(input: CreateBillingPortalSessionInput): Promise<CreateBillingPortalSessionResult>;
  cancelSubscription(input: CancelSubscriptionInput): Promise<void>;
  resumeSubscription(input: ResumeSubscriptionInput): Promise<void>;
  issueRefund(input: IssueRefundInput): Promise<IssueRefundResult>;
}
