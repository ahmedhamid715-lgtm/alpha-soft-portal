import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { subscriptionRepository, subscriptionItemRepository } from "@/server/repositories/subscription-repository";
import { invoiceRepository } from "@/server/repositories/invoice-repository";
import { planRepository, planPriceRepository } from "@/server/repositories/plan-repository";
import { withTenantContext } from "@/lib/tenancy/context";

// `billing-webhook-service.ts` calls `audit.recordSuccess()`, which
// (when no `knownActor` is given) falls back to `getCurrentUser()` to
// resolve an actor — pulling in `@/lib/auth/session-guard` → `@/auth`
// (next-auth's own config) → `next-auth` → `next/server`, which doesn't
// resolve in this bare Vitest/Node environment (no real Next.js runtime
// in the loop). A webhook has no session at all, so mocking this to
// "nobody" is also the semantically correct behavior, not just a test
// workaround.
vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => null),
  getCurrentMembership: vi.fn(async () => null),
}));

/**
 * `billing-webhook-service.ts` (Module 13) — the reconciliation core.
 * Real Postgres, no mocked database layer — only the Stripe SDK client
 * itself is untouched (these fake events never trigger a real API call:
 * `payment_intent`-handling's charge lookup only runs when
 * `latest_charge` is a STRING, which these fixtures never set). Proves
 * spec §18 (idempotency, including under real concurrency), §50
 * (out-of-order events never overwrite newer state), and the actual
 * event → Alpha OS row mapping for the events this module implements.
 */
describe.skipIf(!isDatabaseConfigured)("billing-webhook-service (database integration)", () => {
  const orgIds: string[] = [];
  const planIds: string[] = [];
  let orgAId: string;
  let customerId: string;

  beforeEach(async () => {
    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Webhook Test Org A", displayName: "Webhook Test Org A", slug: `webhook-org-a-${orgAId}` });
    orgIds.push(orgAId);

    customerId = `cus_webhook_test_${generateId()}`;
    // The row's own reference isn't needed after creation — every
    // handler under test resolves the account back through
    // `providerCustomerId`, exactly like a real webhook would.
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: customerId }, tx),
    );
  });

  afterEach(async () => {
    // Organizations first — cascades away Subscription/SubscriptionItem
    // before a Plan's own Restrict-guarded PlanPrice is deleted (same
    // FK-ordering discipline every other billing test file in this repo
    // follows — see subscription-concurrency.test.ts's own comment).
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    if (planIds.length) await db.plan.deleteMany({ where: { id: { in: planIds } } });
    orgIds.length = 0;
    planIds.length = 0;
    vi.restoreAllMocks();
  });

  function subscriptionEvent(overrides: {
    id?: string;
    type?: "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted";
    subscriptionId: string;
    status: string;
    created?: number;
    cancelAtPeriodEnd?: boolean;
    canceledAt?: number | null;
    items?: Array<{ id: string; priceId: string; quantity?: number }>;
  }): Stripe.Event {
    return {
      id: overrides.id ?? `evt_${generateId()}`,
      type: overrides.type ?? "customer.subscription.updated",
      created: overrides.created ?? Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: overrides.subscriptionId,
          customer: customerId,
          status: overrides.status,
          cancel_at_period_end: overrides.cancelAtPeriodEnd ?? false,
          canceled_at: overrides.canceledAt ?? null,
          trial_start: null,
          trial_end: null,
          items: {
            data: (overrides.items ?? []).map((item) => ({
              id: item.id,
              price: { id: item.priceId },
              quantity: item.quantity ?? 1,
              // This Stripe API version carries the current period on
              // each ITEM, not the subscription object itself — see
              // `extractStripeCurrentPeriod()`'s own comment.
              current_period_start: overrides.created ?? Math.floor(Date.now() / 1000),
              current_period_end: (overrides.created ?? Math.floor(Date.now() / 1000)) + 30 * 24 * 60 * 60,
            })),
          },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("processes a new customer.subscription.created event: creates a local Subscription with the mapped status", async () => {
    const { processStripeWebhookEvent } = await import("@/server/services/billing-webhook-service");
    const providerSubscriptionId = `sub_test_${generateId()}`;
    const event = subscriptionEvent({ type: "customer.subscription.created", subscriptionId: providerSubscriptionId, status: "active" });

    const result = await processStripeWebhookEvent(event);
    expect(result.outcome).toBe("processed");

    const row = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.findByProviderSubscriptionId("STRIPE", providerSubscriptionId, tx),
    );
    expect(row?.status).toBe("ACTIVE");
    expect(row?.organizationId).toBe(orgAId);
  });

  it("the SAME event.id delivered twice is idempotent — the second delivery is a no-op 'duplicate', never a second row", async () => {
    const { processStripeWebhookEvent } = await import("@/server/services/billing-webhook-service");
    const eventId = `evt_${generateId()}`;
    const providerSubscriptionId = `sub_dup_test_${generateId()}`;
    const event = subscriptionEvent({ id: eventId, type: "customer.subscription.created", subscriptionId: providerSubscriptionId, status: "active" });

    const first = await processStripeWebhookEvent(event);
    expect(first.outcome).toBe("processed");
    const second = await processStripeWebhookEvent(event);
    expect(second.outcome).toBe("duplicate");

    const events = await db.billingWebhookEvent.findMany({ where: { providerEventId: eventId } });
    expect(events).toHaveLength(1);

    const subs = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.listForOrganization(orgAId, tx),
    );
    expect(subs.filter((s) => s.providerSubscriptionId === providerSubscriptionId)).toHaveLength(1);
  });

  it("an in-place Stripe item price change (SAME providerItemId, new price — exactly what changeSubscriptionPlan()'s own stripe.subscriptions.update() produces) updates the local SubscriptionItem's planPriceId, rather than leaving it silently stale (Module 15 regression — see billing-webhook-service.ts's own comment)", async () => {
    const plan = await planRepository.create({ id: generateId(), key: `webhook_item_update_plan_${generateId().replace(/-/g, "_")}`.slice(0, 40), name: "Webhook Item Update Plan" });
    planIds.push(plan.id);
    const priceA = await planPriceRepository.create({ id: generateId(), planId: plan.id, currency: "USD", unitAmount: 1000, interval: "MONTH", provider: "STRIPE", providerPriceId: `price_wh_a_${generateId()}` });
    const priceB = await planPriceRepository.create({ id: generateId(), planId: plan.id, currency: "USD", unitAmount: 2000, interval: "MONTH", provider: "STRIPE", providerPriceId: `price_wh_b_${generateId()}` });

    const { processStripeWebhookEvent } = await import("@/server/services/billing-webhook-service");
    const providerSubscriptionId = `sub_item_update_test_${generateId()}`;
    const providerItemId = `si_item_update_test_${generateId()}`;

    // First event: subscription created on price A.
    const created = subscriptionEvent({
      type: "customer.subscription.created",
      subscriptionId: providerSubscriptionId,
      status: "active",
      created: Math.floor(Date.now() / 1000),
      items: [{ id: providerItemId, priceId: priceA.providerPriceId! }],
    });
    await processStripeWebhookEvent(created);

    const subscription = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.findByProviderSubscriptionId("STRIPE", providerSubscriptionId, tx),
    );
    const itemsAfterCreate = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionItemRepository.listForSubscription(subscription!.id, tx),
    );
    expect(itemsAfterCreate).toHaveLength(1);
    expect(itemsAfterCreate[0]?.planPriceId).toBe(priceA.id);

    // Second event, one second later (never out-of-order-guarded away):
    // the SAME provider item id, now pointing at price B — exactly what
    // an in-place Stripe item modification reports.
    const updated = subscriptionEvent({
      type: "customer.subscription.updated",
      subscriptionId: providerSubscriptionId,
      status: "active",
      created: Math.floor(Date.now() / 1000) + 1,
      items: [{ id: providerItemId, priceId: priceB.providerPriceId! }],
    });
    await processStripeWebhookEvent(updated);

    const itemsAfterUpdate = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionItemRepository.listForSubscription(subscription!.id, tx),
    );
    expect(itemsAfterUpdate).toHaveLength(1); // still exactly one row — an UPDATE, never a second item
    expect(itemsAfterUpdate[0]?.id).toBe(itemsAfterCreate[0]?.id); // same row, in place
    expect(itemsAfterUpdate[0]?.planPriceId).toBe(priceB.id); // and it now reflects the real, current price
  });

  it("two CONCURRENT deliveries of the same event.id: exactly one processes, the other is a duplicate — proven under real concurrency, not just sequentially", async () => {
    const { processStripeWebhookEvent } = await import("@/server/services/billing-webhook-service");
    const eventId = `evt_concurrent_${generateId()}`;
    const providerSubscriptionId = `sub_concurrent_test_${generateId()}`;
    const event = subscriptionEvent({ id: eventId, type: "customer.subscription.created", subscriptionId: providerSubscriptionId, status: "active" });

    const [a, b] = await Promise.all([processStripeWebhookEvent(event), processStripeWebhookEvent(event)]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["duplicate", "processed"]);

    const rows = await db.billingWebhookEvent.findMany({ where: { providerEventId: eventId } });
    expect(rows).toHaveLength(1); // the UNIQUE(provider, providerEventId) constraint is the real guarantee
  });

  it("an out-of-order event (earlier event.created than the last applied one) is ignored — never overwrites newer state (spec §50)", async () => {
    const { processStripeWebhookEvent } = await import("@/server/services/billing-webhook-service");
    const providerSubscriptionId = `sub_order_test_${generateId()}`;
    const now = Math.floor(Date.now() / 1000);

    // The NEWER event arrives first (status ACTIVE).
    await processStripeWebhookEvent(subscriptionEvent({ subscriptionId: providerSubscriptionId, status: "active", created: now }));
    // The OLDER, stale event arrives second (status PAST_DUE) — must be ignored, not applied over the newer ACTIVE state.
    const stale = await processStripeWebhookEvent(subscriptionEvent({ subscriptionId: providerSubscriptionId, status: "past_due", created: now - 3600 }));
    expect(stale.outcome).toBe("processed"); // the EVENT itself is still recorded/idempotency-tracked — "processed" describes webhook bookkeeping, not that it changed state

    const row = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.findByProviderSubscriptionId("STRIPE", providerSubscriptionId, tx),
    );
    expect(row?.status).toBe("ACTIVE"); // NOT overwritten to PAST_DUE by the stale event
  });

  it("an unrecognized event type is marked IGNORED, not FAILED or silently dropped", async () => {
    const { processStripeWebhookEvent } = await import("@/server/services/billing-webhook-service");
    const event = { id: `evt_${generateId()}`, type: "some.unrecognized.event", created: Math.floor(Date.now() / 1000), data: { object: {} } } as unknown as Stripe.Event;

    const result = await processStripeWebhookEvent(event);
    expect(result.outcome).toBe("ignored");

    const row = await db.billingWebhookEvent.findUnique({ where: { provider_providerEventId: { provider: "STRIPE", providerEventId: event.id } } });
    expect(row?.status).toBe("IGNORED");
  });

  it("an event referencing an unknown Stripe customer is marked FAILED (not silently dropped, not applied to the wrong organization)", async () => {
    const { processStripeWebhookEvent } = await import("@/server/services/billing-webhook-service");
    const event = {
      id: `evt_${generateId()}`,
      type: "customer.subscription.created",
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: `sub_orphan_${generateId()}`, customer: "cus_does_not_exist", status: "active", cancel_at_period_end: false, canceled_at: null, trial_start: null, trial_end: null, items: { data: [] } } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await expect(processStripeWebhookEvent(event)).rejects.toThrow();

    const row = await db.billingWebhookEvent.findUnique({ where: { provider_providerEventId: { provider: "STRIPE", providerEventId: event.id } } });
    expect(row?.status).toBe("FAILED");
    expect(row?.error).toContain("cus_does_not_exist");
  });

  it("invoice.created writes an immutable Invoice with a server-generated invoiceNumber; a subsequent invoice.paid updates status/amounts without rewriting line items", async () => {
    const { processStripeWebhookEvent } = await import("@/server/services/billing-webhook-service");
    const providerInvoiceId = `in_test_${generateId()}`;
    const now = Math.floor(Date.now() / 1000);

    const createdEvent = {
      id: `evt_${generateId()}`,
      type: "invoice.created",
      created: now,
      data: {
        object: {
          id: providerInvoiceId,
          customer: customerId,
          status: "open",
          currency: "usd",
          subtotal: 5000,
          total: 5000,
          amount_paid: 0,
          amount_due: 5000,
          created: now,
          due_date: null,
          hosted_invoice_url: "https://invoice.stripe.com/test",
          status_transitions: { paid_at: null },
          total_discount_amounts: [],
          lines: { data: [{ id: "il_1", description: "Test line", quantity: 1, subtotal: 5000, amount: 5000, discount_amounts: [], taxes: [], pricing: null }] },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const createdResult = await processStripeWebhookEvent(createdEvent);
    expect(createdResult.outcome).toBe("processed");

    const invoice = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      invoiceRepository.findByProviderInvoiceId("STRIPE", providerInvoiceId, tx),
    );
    expect(invoice?.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(invoice?.status).toBe("OPEN");

    const withLines = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => invoiceRepository.findByIdWithLineItems(invoice!.id, tx));
    expect(withLines?.lineItems).toHaveLength(1);

    const paidEvent = {
      id: `evt_${generateId()}`,
      type: "invoice.paid",
      created: now + 60,
      data: {
        object: {
          id: providerInvoiceId,
          customer: customerId,
          status: "paid",
          currency: "usd",
          amount_paid: 5000,
          amount_due: 0,
          status_transitions: { paid_at: now + 60 },
          confirmation_secret: null, // no PaymentIntent linkage available for this fixture — Payment creation is best-effort (see billing-webhooks.md)
          hosted_invoice_url: "https://invoice.stripe.com/test",
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const paidResult = await processStripeWebhookEvent(paidEvent);
    expect(paidResult.outcome).toBe("processed");

    const updatedInvoice = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => invoiceRepository.findByIdWithLineItems(invoice!.id, tx));
    expect(updatedInvoice?.status).toBe("PAID");
    expect(updatedInvoice?.amountPaid).toBe(5000);
    expect(updatedInvoice?.lineItems).toHaveLength(1); // unchanged — never rewritten (spec §11 immutability)
  });
});
