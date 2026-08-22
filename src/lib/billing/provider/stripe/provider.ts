import "server-only";
import Stripe from "stripe";
import { getStripeClient } from "./client";
import { ExternalServiceError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging";
import type { BillingProviderAdapter } from "../interface";
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
} from "../types";

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
};

/** Stripe's `refunds.create` reason is a closed enum — an arbitrary internal reason string is mapped to Stripe's closest match, defaulting to `requested_by_customer` rather than rejecting the call over a vocabulary mismatch (the FREE-TEXT reason itself is still preserved verbatim in Alpha OS's own `Refund.reason` column). */
function mapRefundReason(reason: string): Stripe.RefundCreateParams.Reason {
  const normalized = reason.toLowerCase();
  if (normalized.includes("duplicate")) return "duplicate";
  if (normalized.includes("fraud")) return "fraudulent";
  return "requested_by_customer";
}
