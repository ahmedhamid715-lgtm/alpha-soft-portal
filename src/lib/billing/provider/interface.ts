import type {
  CancelSubscriptionInput,
  ChangeSubscriptionInput,
  CreateBillingPortalSessionInput,
  CreateBillingPortalSessionResult,
  CreateCheckoutSessionInput,
  CreateCheckoutSessionResult,
  CreateProviderCustomerInput,
  CreateProviderCustomerResult,
  ExtendTrialInput,
  GetSubscriptionResult,
  IssueRefundInput,
  IssueRefundResult,
  PreviewSubscriptionChangeResult,
  ResumeSubscriptionInput,
  RetryInvoicePaymentInput,
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

  /**
   * Module 14 — the real in-place upgrade/downgrade primitives (spec
   * §5/§35). `previewSubscriptionChange()` never mutates anything;
   * `changeSubscription()` updates the EXISTING Stripe subscription
   * item, never creating a second subscription the way a fresh Checkout
   * Session would (see `subscription-lifecycle.md` "The in-place change
   * bug Module 13 left behind").
   */
  previewSubscriptionChange(input: ChangeSubscriptionInput): Promise<PreviewSubscriptionChangeResult>;
  changeSubscription(input: ChangeSubscriptionInput): Promise<void>;

  /** Read-only, live provider state — the one legitimate reconciliation-only exception to "the webhook processor is the only writer" (see `billing-reconciliation-service.ts`); this method itself never writes anything. */
  getSubscription(providerSubscriptionId: string): Promise<GetSubscriptionResult | null>;

  extendTrial(input: ExtendTrialInput): Promise<void>;

  /** Forces an immediate retry attempt outside the provider's own automatic retry schedule (spec §13) — never a second, competing retry engine of Alpha OS's own. */
  retryInvoicePayment(input: RetryInvoicePaymentInput): Promise<void>;
}
