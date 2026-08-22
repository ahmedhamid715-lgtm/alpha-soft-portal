import "server-only";
import type Stripe from "stripe";
import { generateId } from "@/lib/utils/id";
import { withTenantContext } from "@/lib/tenancy/context";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { logger } from "@/lib/logging";
import { billingWebhookEventRepository } from "@/server/repositories/billing-webhook-event-repository";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { subscriptionRepository, subscriptionItemRepository } from "@/server/repositories/subscription-repository";
import { invoiceRepository } from "@/server/repositories/invoice-repository";
import { paymentRepository, refundRepository } from "@/server/repositories/payment-repository";
import { planPriceRepository } from "@/server/repositories/plan-repository";
import { nextInvoiceNumber } from "@/lib/billing/invoice-numbering";
import { getStripeClient } from "@/lib/billing/provider/stripe/client";
import {
  mapStripeSubscriptionStatus,
  mapStripeInvoiceStatus,
  mapStripePaymentIntentStatus,
  mapStripeRefundStatus,
  extractStripeSubscriptionItems,
  extractStripeCurrentPeriod,
  extractStripePaymentMethodDisplay,
} from "@/lib/billing/provider/stripe/mapper";

/**
 * The reconciliation core (spec §17/§21/§44) — the ONLY place a Stripe
 * webhook event becomes Alpha OS state. `app/api/webhooks/stripe/route.ts`
 * verifies the signature and hands the resulting `Stripe.Event` here;
 * everything below assumes the event is genuine.
 *
 * Every write happens inside `withTenantContext({ isPlatformStaff: true,
 * ... })` (spec §23: "do not bypass tenant isolation with a convenient
 * global query") — there is no user session here at all (a webhook has
 * no browser, no cookie, no logged-in identity), so `userId: null` +
 * `isPlatformStaff: true` is the correct, honest context: the same
 * platform-bypass shape every other system-initiated write in this
 * codebase already uses (`getOrganizationForPlatform()`,
 * `organization-management-service.ts`'s platform reads).
 */

const eventDate = (unixSeconds: number): Date => new Date(unixSeconds * 1000);

async function resolveBillingAccountByCustomerId(customerId: string) {
  return withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) =>
    billingAccountRepository.findByProviderCustomerId("STRIPE", customerId, tx),
  );
}

/**
 * Handles `customer.subscription.created`/`.updated`/`.deleted` — all
 * three converge on the same reconciliation (Stripe's own `.deleted`
 * event is really just a subscription object whose `status` is already
 * `"canceled"`, not a structurally different payload).
 */
async function handleSubscriptionEvent(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const account = await resolveBillingAccountByCustomerId(customerId);
  if (!account) {
    // No known billing account for this Stripe customer — see
    // billing-webhooks.md "Failure handling: unresolvable events." Not
    // silently dropped: marked FAILED so it's visible in the platform
    // observability list and Stripe's own automatic retries get a
    // chance to arrive after the account exists (a real, if rare, race
    // for an org whose BillingAccount is created out of band).
    throw new Error(`No BillingAccount found for Stripe customer ${customerId}.`);
  }

  const status = mapStripeSubscriptionStatus(subscription.status);
  const { start, end } = extractStripeCurrentPeriod(subscription);
  const eventCreatedAt = eventDate(event.created);

  const result = await withTenantContext({ userId: null, organizationId: account.organizationId, isPlatformStaff: true }, async (tx) => {
    const existing = await subscriptionRepository.findByProviderSubscriptionId("STRIPE", subscription.id, tx);

    // Out-of-order guard (spec §50) — a newly-arrived event older than
    // the last one already applied to this row is ignored, never
    // applied over a newer state.
    if (existing?.providerEventTimestamp && existing.providerEventTimestamp.getTime() > eventCreatedAt.getTime()) {
      return { row: existing, isNew: false, stale: true, previousStatus: existing.status };
    }

    const providerState = {
      status,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: subscription.canceled_at ? eventDate(subscription.canceled_at) : null,
      trialStart: subscription.trial_start ? eventDate(subscription.trial_start) : null,
      trialEnd: subscription.trial_end ? eventDate(subscription.trial_end) : null,
      providerEventTimestamp: eventCreatedAt,
    };

    const row = existing
      ? await subscriptionRepository.applyProviderState(existing.id, providerState, tx)
      : await (async () => {
          const created = await subscriptionRepository.create(
            { id: generateId(), organizationId: account.organizationId, billingAccountId: account.id, provider: "STRIPE", providerSubscriptionId: subscription.id, status },
            tx,
          );
          return subscriptionRepository.applyProviderState(created.id, providerState, tx);
        })();

    // Reconcile items — only NEW items are added (spec's own scope:
    // single-item subscriptions are this module's primary supported
    // case; a quantity/price CHANGE on an existing item arrives as a
    // new `providerItemId` from Stripe in practice for a plan swap via
    // Checkout, which this branch already handles as "new item").
    for (const item of extractStripeSubscriptionItems(subscription)) {
      const alreadyLinked = await subscriptionItemRepository.findByProviderItemId("STRIPE", item.providerItemId, tx);
      if (alreadyLinked) continue;
      const planPrice = await planPriceRepository.findByProviderPriceId("STRIPE", item.providerPriceId, tx);
      if (!planPrice) {
        logger.warn("Webhook subscription item references an unknown PlanPrice — skipped.", {
          operation: "billing.webhook.subscription_item_unknown_price",
          providerPriceId: item.providerPriceId,
          subscriptionId: row.id,
        });
        continue;
      }
      await subscriptionItemRepository.create(
        { id: generateId(), subscriptionId: row.id, planPriceId: planPrice.id, quantity: item.quantity, provider: "STRIPE", providerItemId: item.providerItemId },
        tx,
      );
    }

    await audit.recordSuccess({
      action: existing ? "billing.subscription.updated" : "billing.subscription.created",
      organizationId: account.organizationId,
      resourceType: "subscription",
      resourceId: row.id,
      newState: { status: row.status, cancelAtPeriodEnd: row.cancelAtPeriodEnd },
      tx,
    });

    return { row, isNew: !existing, stale: false, previousStatus: existing?.status ?? null };
  });

  if (result.stale) {
    logger.info("Stale (out-of-order) subscription webhook ignored.", {
      operation: "billing.webhook.subscription_stale",
      organizationId: account.organizationId,
      subscriptionId: result.row.id,
      eventId: event.id,
    });
    return;
  }

  await events.emit(result.isNew ? "billing.subscription.created" : "billing.subscription.updated", {
    organizationId: account.organizationId,
    subscriptionId: result.row.id,
    status: result.row.status,
    previousStatus: result.previousStatus,
  });
}

/** `invoice.created` — the ONE point `InvoiceLineItem` rows are ever written (spec §11: immutable after creation). */
async function handleInvoiceCreated(event: Stripe.Event): Promise<void> {
  const stripeInvoice = event.data.object as Stripe.Invoice;
  const customerId = typeof stripeInvoice.customer === "string" ? stripeInvoice.customer : stripeInvoice.customer?.id;
  if (!customerId) throw new Error("Invoice event has no customer.");

  const account = await resolveBillingAccountByCustomerId(customerId);
  if (!account) throw new Error(`No BillingAccount found for Stripe customer ${customerId}.`);

  await withTenantContext({ userId: null, organizationId: account.organizationId, isPlatformStaff: true }, async (tx) => {
    const existing = stripeInvoice.id ? await invoiceRepository.findByProviderInvoiceId("STRIPE", stripeInvoice.id, tx) : null;
    if (existing) return; // already recorded — a re-delivered or re-emitted `invoice.created`, never re-written (immutability).

    let subscriptionId: string | null = null;
    const subRef = (stripeInvoice as unknown as { subscription?: string | { id: string } | null }).subscription;
    if (subRef) {
      const providerSubscriptionId = typeof subRef === "string" ? subRef : subRef.id;
      const sub = await subscriptionRepository.findByProviderSubscriptionId("STRIPE", providerSubscriptionId, tx);
      subscriptionId = sub?.id ?? null;
    }

    const invoiceNumber = await nextInvoiceNumber(tx);
    const invoice = await invoiceRepository.create(
      {
        id: generateId(),
        organizationId: account.organizationId,
        billingAccountId: account.id,
        subscriptionId,
        invoiceNumber,
        status: mapStripeInvoiceStatus(stripeInvoice.status),
        currency: stripeInvoice.currency.toUpperCase(),
        subtotal: stripeInvoice.subtotal,
        discountTotal: stripeInvoice.total_discount_amounts?.reduce((sum, d) => sum + d.amount, 0) ?? 0,
        taxTotal: (stripeInvoice.total ?? 0) - (stripeInvoice.subtotal ?? 0) > 0 ? (stripeInvoice.total ?? 0) - (stripeInvoice.subtotal ?? 0) : 0,
        total: stripeInvoice.total,
        amountPaid: stripeInvoice.amount_paid,
        amountDue: stripeInvoice.amount_due,
        issueDate: eventDate(stripeInvoice.created),
        dueDate: stripeInvoice.due_date ? eventDate(stripeInvoice.due_date) : null,
        paidAt: stripeInvoice.status_transitions.paid_at ? eventDate(stripeInvoice.status_transitions.paid_at) : null,
        provider: "STRIPE",
        providerInvoiceId: stripeInvoice.id ?? null,
        hostedInvoiceUrl: stripeInvoice.hosted_invoice_url ?? null,
      },
      tx,
    );

    for (const line of stripeInvoice.lines.data) {
      const priceRef = line.pricing?.price_details?.price;
      const providerPriceId = typeof priceRef === "string" ? priceRef : priceRef?.id;
      const planPrice = providerPriceId ? await planPriceRepository.findByProviderPriceId("STRIPE", providerPriceId, tx) : null;
      const quantity = line.quantity ?? 1;
      const discountAmount = line.discount_amounts?.reduce((sum, d) => sum + d.amount, 0) ?? 0;
      const taxAmount = line.taxes?.reduce((sum, t) => sum + t.amount, 0) ?? 0;
      await invoiceRepository.addLineItem(
        {
          id: generateId(),
          invoiceId: invoice.id,
          description: line.description ?? "Line item",
          quantity,
          unitAmount: quantity > 0 ? Math.round(line.subtotal / quantity) : line.subtotal,
          subtotal: line.subtotal,
          discountAmount,
          taxAmount,
          total: line.amount,
          planPriceId: planPrice?.id ?? null,
        },
        tx,
      );
    }

    await audit.recordSuccess({
      action: "billing.invoice.created",
      organizationId: account.organizationId,
      resourceType: "invoice",
      resourceId: invoice.id,
      resourceName: invoice.invoiceNumber,
      newState: { total: invoice.total, currency: invoice.currency, status: invoice.status },
      tx,
    });

    await events.emit("billing.invoice.created", { organizationId: account.organizationId, invoiceId: invoice.id });
  });
}

/** `invoice.finalized`/`invoice.paid`/`invoice.payment_failed` — status/amount updates only, never a line-item rewrite. */
async function handleInvoiceStatusChange(event: Stripe.Event): Promise<void> {
  const stripeInvoice = event.data.object as Stripe.Invoice;
  if (!stripeInvoice.id) return;
  const customerId = typeof stripeInvoice.customer === "string" ? stripeInvoice.customer : stripeInvoice.customer?.id;
  if (!customerId) throw new Error("Invoice event has no customer.");

  const account = await resolveBillingAccountByCustomerId(customerId);
  if (!account) throw new Error(`No BillingAccount found for Stripe customer ${customerId}.`);

  await withTenantContext({ userId: null, organizationId: account.organizationId, isPlatformStaff: true }, async (tx) => {
    const invoice = await invoiceRepository.findByProviderInvoiceId("STRIPE", stripeInvoice.id!, tx);
    if (!invoice) return; // `invoice.created` hasn't been processed yet for this invoice — Stripe's own event ordering doesn't guarantee this arrives first; safely skipped, a later re-delivery (or the eventual `invoice.created`) settles it.

    const updated = await invoiceRepository.updateStatusAndAmounts(
      invoice.id,
      {
        status: mapStripeInvoiceStatus(stripeInvoice.status),
        amountPaid: stripeInvoice.amount_paid,
        amountDue: stripeInvoice.amount_due,
        paidAt: stripeInvoice.status_transitions.paid_at ? eventDate(stripeInvoice.status_transitions.paid_at) : null,
        hostedInvoiceUrl: stripeInvoice.hosted_invoice_url ?? undefined,
      },
      tx,
    );

    // Best-effort Payment linkage (see billing-webhooks.md "Invoice →
    // Payment linkage — a documented best-effort join" for the full
    // reasoning): the PaymentIntent id is recoverable from the
    // invoice's own `confirmation_secret.client_secret`
    // (`{intentId}_secret_{...}`, a stable Stripe convention), which is
    // the only reference available on this API version's Invoice
    // object at all.
    const clientSecret = stripeInvoice.confirmation_secret?.client_secret;
    const providerPaymentId = clientSecret?.split("_secret_")[0];
    if (providerPaymentId && event.type === "invoice.paid") {
      const existingPayment = await paymentRepository.findByProviderPaymentId("STRIPE", providerPaymentId, tx);
      if (existingPayment && !existingPayment.invoiceId) {
        await tx.payment.update({ where: { id: existingPayment.id }, data: { invoiceId: invoice.id } });
      } else if (!existingPayment) {
        await paymentRepository.create(
          {
            id: generateId(),
            organizationId: account.organizationId,
            billingAccountId: account.id,
            invoiceId: invoice.id,
            amount: stripeInvoice.amount_paid,
            currency: stripeInvoice.currency.toUpperCase(),
            status: "SUCCEEDED",
            provider: "STRIPE",
            providerPaymentId,
            paidAt: stripeInvoice.status_transitions.paid_at ? eventDate(stripeInvoice.status_transitions.paid_at) : new Date(),
          },
          tx,
        );
      }
    }

    await audit.recordSuccess({
      action: event.type === "invoice.payment_failed" ? "billing.payment.failed" : "billing.invoice.created",
      organizationId: account.organizationId,
      resourceType: "invoice",
      resourceId: invoice.id,
      resourceName: invoice.invoiceNumber,
      newState: { status: updated.status, amountPaid: updated.amountPaid, amountDue: updated.amountDue },
      tx,
    });

    if (event.type === "invoice.paid") {
      await events.emit("billing.payment.succeeded", { organizationId: account.organizationId, invoiceId: invoice.id });
    } else if (event.type === "invoice.payment_failed") {
      await events.emit("billing.payment.failed", { organizationId: account.organizationId, invoiceId: invoice.id });
    }
  });
}

/** `payment_intent.succeeded`/`.payment_failed` — the non-invoice (one-time-charge) path; also the safety net if a Payment wasn't already linked by `invoice.paid`. */
async function handlePaymentIntentEvent(event: Stripe.Event): Promise<void> {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;
  const customerId = typeof paymentIntent.customer === "string" ? paymentIntent.customer : paymentIntent.customer?.id;
  if (!customerId) {
    logger.info("PaymentIntent webhook has no customer — ignored (not an Alpha OS-tracked payment).", { operation: "billing.webhook.payment_intent_no_customer", eventId: event.id });
    return;
  }

  const account = await resolveBillingAccountByCustomerId(customerId);
  if (!account) throw new Error(`No BillingAccount found for Stripe customer ${customerId}.`);

  let paymentMethodDisplay: ReturnType<typeof extractStripePaymentMethodDisplay> = { paymentMethodType: null, paymentMethodBrand: null, paymentMethodLast4: null };
  if (typeof paymentIntent.latest_charge === "string") {
    try {
      const charge = await getStripeClient().charges.retrieve(paymentIntent.latest_charge);
      paymentMethodDisplay = extractStripePaymentMethodDisplay(charge);
    } catch (error) {
      logger.warn("Failed to retrieve charge for payment-method display fields — continuing without them.", { operation: "billing.webhook.charge_lookup_failed", eventId: event.id, cause: String(error) });
    }
  }

  const status = mapStripePaymentIntentStatus(paymentIntent.status);

  await withTenantContext({ userId: null, organizationId: account.organizationId, isPlatformStaff: true }, async (tx) => {
    const existing = await paymentRepository.findByProviderPaymentId("STRIPE", paymentIntent.id, tx);
    const row = existing
      ? await paymentRepository.updateStatus(
          existing.id,
          { status, failureCode: paymentIntent.last_payment_error?.code ?? null, failureMessage: paymentIntent.last_payment_error?.message ?? null, paidAt: status === "SUCCEEDED" ? new Date() : existing.paidAt },
          tx,
        )
      : await paymentRepository.create(
          {
            id: generateId(),
            organizationId: account.organizationId,
            billingAccountId: account.id,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency.toUpperCase(),
            status,
            provider: "STRIPE",
            providerPaymentId: paymentIntent.id,
            ...paymentMethodDisplay,
            failureCode: paymentIntent.last_payment_error?.code ?? null,
            failureMessage: paymentIntent.last_payment_error?.message ?? null,
            paidAt: status === "SUCCEEDED" ? new Date() : null,
          },
          tx,
        );

    await audit.recordSuccess({
      action: status === "SUCCEEDED" ? "billing.payment.succeeded" : "billing.payment.failed",
      organizationId: account.organizationId,
      resourceType: "payment",
      resourceId: row.id,
      newState: { status: row.status, amount: row.amount, currency: row.currency },
      tx,
    });
  });

  await events.emit(status === "SUCCEEDED" ? "billing.payment.succeeded" : "billing.payment.failed", { organizationId: account.organizationId });
}

/** `charge.refunded` — reconciles a refund issued directly in the Stripe dashboard (not through `issueRefund()`), so Alpha OS's own `Refund` history stays complete regardless of where a refund originated. */
async function handleChargeRefunded(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const customerId = typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
  if (!customerId) return;
  const account = await resolveBillingAccountByCustomerId(customerId);
  if (!account) throw new Error(`No BillingAccount found for Stripe customer ${customerId}.`);

  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) return;

  await withTenantContext({ userId: null, organizationId: account.organizationId, isPlatformStaff: true }, async (tx) => {
    const payment = await paymentRepository.findByProviderPaymentId("STRIPE", paymentIntentId, tx);
    if (!payment) return; // no locally-known payment to attach this refund to yet

    for (const refund of charge.refunds?.data ?? []) {
      const existing = await refundRepository.findByProviderRefundId("STRIPE", refund.id, tx);
      if (existing) continue;
      const row = await refundRepository.create(
        {
          id: generateId(),
          paymentId: payment.id,
          amount: refund.amount,
          currency: refund.currency.toUpperCase(),
          reason: refund.reason ?? null,
          status: mapStripeRefundStatus(refund.status),
          provider: "STRIPE",
          providerRefundId: refund.id,
          initiatedByUserId: null, // dashboard-initiated — no Alpha OS actor (see schema.prisma's own doc comment on this field)
        },
        tx,
      );
      await paymentRepository.updateStatus(payment.id, { status: charge.amount_refunded >= charge.amount ? "REFUNDED" : "PARTIALLY_REFUNDED" }, tx);
      await audit.recordSuccess({
        action: "billing.refund.created",
        organizationId: account.organizationId,
        resourceType: "refund",
        resourceId: row.id,
        newState: { amount: row.amount, currency: row.currency, status: row.status },
        tx,
      });
    }
  });
}

/**
 * `customer.subscription.trial_will_end` (Module 14 spec §19/§29's
 * "trial ending" notification) — Stripe itself fires this automatically
 * 3 days before a trial ends; Alpha OS never runs its own scheduled
 * job to detect it (spec's own "do not create a fake retry/scheduling
 * engine if the provider already manages it"). No local state changes
 * — this is purely a notification trigger.
 */
async function handleTrialWillEnd(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const account = await resolveBillingAccountByCustomerId(customerId);
  if (!account) throw new Error(`No BillingAccount found for Stripe customer ${customerId}.`);

  const local = await withTenantContext({ userId: null, organizationId: account.organizationId, isPlatformStaff: true }, (tx) =>
    subscriptionRepository.findByProviderSubscriptionId("STRIPE", subscription.id, tx),
  );
  if (!local) return; // the subscription.created reconciliation hasn't landed yet — nothing to notify about yet

  await events.emit("billing.trial.ending", { organizationId: account.organizationId, subscriptionId: local.id });
}

/** Event types this module deliberately does not act on (spec §19: "document intentionally unsupported events") — see billing-webhooks.md for the full reasoning per event. */
const IGNORED_EVENT_TYPES = new Set<string>([
  "customer.created",
  "customer.updated",
  "checkout.session.completed", // superseded by customer.subscription.created/updated — see this file's own top comment
  "invoice.updated",
]);

async function dispatch(event: Stripe.Event): Promise<"processed" | "ignored"> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await handleSubscriptionEvent(event);
      return "processed";
    case "invoice.created":
      await handleInvoiceCreated(event);
      return "processed";
    case "invoice.finalized":
    case "invoice.paid":
    case "invoice.payment_failed":
      await handleInvoiceStatusChange(event);
      return "processed";
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed":
      await handlePaymentIntentEvent(event);
      return "processed";
    case "charge.refunded":
      await handleChargeRefunded(event);
      return "processed";
    case "customer.subscription.trial_will_end":
      await handleTrialWillEnd(event);
      return "processed";
    default:
      if (!IGNORED_EVENT_TYPES.has(event.type)) {
        logger.info("Unrecognized Stripe webhook event type — ignored.", { operation: "billing.webhook.unrecognized_event", eventType: event.type, eventId: event.id });
      }
      return "ignored";
  }
}

/**
 * The webhook entrypoint (spec §18) — idempotent by construction:
 * `billingWebhookEventRepository.tryInsert()`'s underlying
 * `UNIQUE(provider, providerEventId)` constraint is the real guarantee,
 * proven under real concurrent delivery in
 * `billing-webhook-concurrency.test.ts`, not just reasoned about.
 */
export async function processStripeWebhookEvent(event: Stripe.Event): Promise<{ outcome: "processed" | "ignored" | "duplicate" }> {
  const inserted = await billingWebhookEventRepository.tryInsert({
    id: generateId(),
    provider: "STRIPE",
    providerEventId: event.id,
    eventType: event.type,
    payload: event as unknown as Record<string, unknown>,
  });
  if (!inserted) {
    logger.info("Duplicate Stripe webhook event — already recorded, skipped.", { operation: "billing.webhook.duplicate", eventId: event.id, eventType: event.type });
    return { outcome: "duplicate" };
  }

  try {
    const outcome = await dispatch(event);
    if (outcome === "ignored") {
      await billingWebhookEventRepository.markIgnored(inserted.id);
    } else {
      await billingWebhookEventRepository.markProcessed(inserted.id);
    }
    logger.info("Stripe webhook event processed.", { operation: "billing.webhook.process", eventId: event.id, eventType: event.type, outcome });
    return { outcome };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await billingWebhookEventRepository.markFailed(inserted.id, message);
    logger.error("Stripe webhook event processing failed.", { operation: "billing.webhook.process_failed", eventId: event.id, eventType: event.type, error: message });
    // Best-effort, outside any transaction (there may not be one open
    // at this point — the failure could have happened before one was
    // even started) — an audit-write failure here must never mask the
    // real webhook failure being re-thrown below.
    await audit
      .recordFailure({ action: "billing.webhook.failed", resourceType: "billing_webhook_event", resourceId: inserted.id, resourceName: event.type, metadata: { eventId: event.id, eventType: event.type } })
      .catch((auditError) => logger.error("Failed to record billing.webhook.failed audit event.", { eventId: event.id, error: String(auditError) }));
    throw error; // the route handler returns 5xx, so Stripe retries — see billing-webhooks.md "Failure handling"
  }
}
