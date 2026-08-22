import "server-only";
import Stripe from "stripe";
import { getStripeClient } from "./client";
import { ExternalServiceError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging";
import type { BillingProviderAdapter } from "../interface";
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
} from "../types";
import { mapStripeSubscriptionStatus } from "./mapper";

/**
 * The Stripe implementation of `BillingProviderAdapter` (spec §16) — the
 * only file in the codebase that constructs a Stripe API request. Every
 * method translates Alpha OS domain inputs into the corresponding Stripe
 * call and back; nothing here is trusted as authoritative application
 * state on its own — see `billing-webhook-service.ts` for where a
 * provider's async response to one of these calls actually gets
 * reconciled into Alpha OS's own tables.
 *
 * Every method wraps its Stripe SDK call in a try/catch that re-throws
 * as `ExternalServiceError("Stripe")` (spec §42/§49) — a customer or
 * platform-staff caller never sees a raw Stripe error message, and a
 * temporarily-unavailable Stripe never corrupts local state (nothing
 * here writes to Postgres at all; see the module's own top comment).
 */
async function withStripeErrorMapping<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.warn("Stripe API call failed.", {
      operation,
      // Stripe's own error classes expose a safe `.type`/`.code` without
      // the full message (which can echo request parameters) — logged
      // for diagnosability (spec §47), never sent to a client response.
      stripeErrorType: error instanceof Stripe.errors.StripeError ? error.type : undefined,
      stripeErrorCode: error instanceof Stripe.errors.StripeError ? error.code : undefined,
    });
    throw new ExternalServiceError("Stripe", { cause: error });
  }
}

export const stripeBillingProvider: BillingProviderAdapter = {
  async createCustomer(input: CreateProviderCustomerInput): Promise<CreateProviderCustomerResult> {
    return withStripeErrorMapping("createCustomer", async () => {
      const stripe = getStripeClient();
      const customer = await stripe.customers.create({
        name: input.name,
        ...(input.email ? { email: input.email } : {}),
        // The internal organization id, attached as Stripe metadata —
        // recoverable from the Stripe dashboard for support/reconciliation,
        // but Alpha OS itself never reads it back FROM Stripe (spec §38:
        // Stripe is a reference, not the database) — the real mapping
        // lives in `BillingAccount.providerCustomerId`.
        metadata: { alphaOsOrganizationId: input.organizationId },
      });
      return { providerCustomerId: customer.id };
    });
  },

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CreateCheckoutSessionResult> {
    return withStripeErrorMapping("createCheckoutSession", async () => {
      const stripe = getStripeClient();
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: input.providerCustomerId,
        line_items: [{ price: input.providerPriceId, quantity: input.quantity }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        subscription_data: {
          metadata: { alphaOsOrganizationId: input.organizationId, alphaOsPlanPriceId: input.planPriceId },
        },
      });
      if (!session.url) throw new ExternalServiceError("Stripe");
      return { url: session.url };
    });
  },

  async createBillingPortalSession(input: CreateBillingPortalSessionInput): Promise<CreateBillingPortalSessionResult> {
    return withStripeErrorMapping("createBillingPortalSession", async () => {
      const stripe = getStripeClient();
      const session = await stripe.billingPortal.sessions.create({
        customer: input.providerCustomerId,
        return_url: input.returnUrl,
      });
      return { url: session.url };
    });
  },

  async cancelSubscription(input: CancelSubscriptionInput): Promise<void> {
    await withStripeErrorMapping("cancelSubscription", async () => {
      const stripe = getStripeClient();
      if (input.atPeriodEnd) {
        await stripe.subscriptions.update(input.providerSubscriptionId, { cancel_at_period_end: true });
      } else {
        await stripe.subscriptions.cancel(input.providerSubscriptionId);
      }
    });
  },

  async resumeSubscription(input: ResumeSubscriptionInput): Promise<void> {
    await withStripeErrorMapping("resumeSubscription", async () => {
      const stripe = getStripeClient();
      await stripe.subscriptions.update(input.providerSubscriptionId, { cancel_at_period_end: false });
    });
  },

  async issueRefund(input: IssueRefundInput): Promise<IssueRefundResult> {
    return withStripeErrorMapping("issueRefund", async () => {
      const stripe = getStripeClient();
      const refund = await stripe.refunds.create({
        payment_intent: input.providerPaymentId,
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.reason ? { reason: mapRefundReason(input.reason) } : {}),
      });
      return { providerRefundId: refund.id, status: refund.status ?? "pending" };
    });
  },

  async previewSubscriptionChange(input: ChangeSubscriptionInput): Promise<PreviewSubscriptionChangeResult> {
    // Deliberately NOT `withStripeErrorMapping()` (unlike every other
    // method here) — a preview is a best-effort convenience (spec §5:
    // "where the provider cannot guarantee a preview, explicitly
    // indicate that"), so nothing in this method may ever re-throw as
    // `ExternalServiceError`; the caller (`subscription-service.ts`'s
    // `previewPlanChange()`) surfaces `available: false` and the UI
    // shows an honest "not available" state instead of a number.
    // `getStripeClient()` itself is INSIDE this try (not called ahead of
    // it, the way every other method does) — it throws synchronously
    // when Stripe isn't configured at all, which is just as much a
    // "can't preview right now" case as a mid-call API failure, and must
    // be caught here for the same reason.
    try {
      const stripe = getStripeClient();
      const preview = await stripe.invoices.createPreview({
        subscription: input.providerSubscriptionId,
        subscription_details: {
          items: [{ id: input.providerItemId, price: input.providerPriceId, quantity: input.quantity }],
          proration_behavior: "create_prorations",
        },
      });
      return {
        available: true,
        currency: preview.currency.toUpperCase(),
        immediateChangeAmount: preview.amount_due,
        totalAmount: preview.total,
        effectiveAt: Math.floor(Date.now() / 1000),
      };
    } catch (error) {
      logger.warn("Stripe subscription-change preview unavailable — continuing without one.", {
        operation: "previewSubscriptionChange",
        stripeErrorType: error instanceof Stripe.errors.StripeError ? error.type : undefined,
      });
      return { available: false, currency: "", immediateChangeAmount: 0, totalAmount: 0, effectiveAt: Math.floor(Date.now() / 1000) };
    }
  },

  async changeSubscription(input: ChangeSubscriptionInput): Promise<void> {
    await withStripeErrorMapping("changeSubscription", async () => {
      const stripe = getStripeClient();
      await stripe.subscriptions.update(input.providerSubscriptionId, {
        items: [{ id: input.providerItemId, price: input.providerPriceId, quantity: input.quantity }],
        proration_behavior: "create_prorations",
      });
    });
  },

  async getSubscription(providerSubscriptionId: string): Promise<GetSubscriptionResult | null> {
    return withStripeErrorMapping("getSubscription", async () => {
      const stripe = getStripeClient();
      try {
        const subscription = await stripe.subscriptions.retrieve(providerSubscriptionId);
        return {
          providerSubscriptionId: subscription.id,
          status: mapStripeSubscriptionStatus(subscription.status),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          currentPeriodStart: subscription.items.data[0]?.current_period_start ?? null,
          currentPeriodEnd: subscription.items.data[0]?.current_period_end ?? null,
        };
      } catch (error) {
        if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") return null;
        throw error;
      }
    });
  },

  async extendTrial(input: ExtendTrialInput): Promise<void> {
    await withStripeErrorMapping("extendTrial", async () => {
      const stripe = getStripeClient();
      await stripe.subscriptions.update(input.providerSubscriptionId, { trial_end: input.newTrialEndUnixSeconds, proration_behavior: "none" });
    });
  },

  async retryInvoicePayment(input: RetryInvoicePaymentInput): Promise<void> {
    await withStripeErrorMapping("retryInvoicePayment", async () => {
      const stripe = getStripeClient();
      await stripe.invoices.pay(input.providerInvoiceId);
    });
  },
};

/** Stripe's `refunds.create` reason is a closed enum — an arbitrary internal reason string is mapped to Stripe's closest match, defaulting to `requested_by_customer` rather than rejecting the call over a vocabulary mismatch (the FREE-TEXT reason itself is still preserved verbatim in Alpha OS's own `Refund.reason` column). */
function mapRefundReason(reason: string): Stripe.RefundCreateParams.Reason {
  const normalized = reason.toLowerCase();
  if (normalized.includes("duplicate")) return "duplicate";
  if (normalized.includes("fraud")) return "fraudulent";
  return "requested_by_customer";
}
