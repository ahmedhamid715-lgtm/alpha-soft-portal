/**
 * Module 13 (Enterprise Billing, Plans & Subscription Infrastructure)
 * dev fixtures — a real, two-plan catalog (Starter/Growth, each with
 * monthly and annual USD pricing) so the customer-facing plan picker
 * and platform plan-catalog admin view have real data without a real
 * Stripe account configured.
 *
 * Deliberately uses the REPOSITORY layer directly
 * (`planRepository`/`planPriceRepository`), never `plan-service.ts` —
 * same reasoning `seed-notifications.ts`'s own top comment documents:
 * the service layer transitively imports `requirePermission()` →
 * `session-guard` → `next-auth`'s own module graph, which doesn't work
 * inside this bare `tsx` process.
 *
 * `providerPriceId` is left `null` for every seeded price — a real
 * Stripe price only exists once an operator has actually created one in
 * a real (test-mode) Stripe account and synced its id via
 * `/admin/plans`; a fabricated `price_...`-looking string here would be
 * worse than an honest `null` (spec §38: never mirror provider identity
 * the platform doesn't actually control). `startCheckoutForPlanPrice()`
 * already rejects a price with no `providerPriceId` — see
 * `subscription-service.ts` — so this is a safe, honest default, not a
 * silently-broken one.
 *
 * Idempotent: every plan is found-or-created by its own unique `key`.
 *
 * Also seeds ONE realistic billing history fixture on Acme Corp
 * (`acme-corp-dev`, from `seed-rbac.ts`) — a `BillingAccount` +
 * `Subscription` (+ item) + `Invoice` (+ line item) + `Payment`, all
 * with fake-but-honestly-shaped provider ids (`cus_dev_...`, never a
 * real Stripe object) — so the customer billing dashboard, invoice
 * list/detail, and platform billing admin/refund surfaces all have real
 * data to render in a fresh dev environment with no Stripe account
 * configured at all.
 */
import { generateId } from "../src/lib/utils/id";
import { db } from "../src/lib/db/client";
import { planRepository, planPriceRepository } from "../src/server/repositories/plan-repository";
import { organizationRepository } from "../src/server/repositories/organization-repository";
import { billingAccountRepository } from "../src/server/repositories/billing-account-repository";
import { subscriptionRepository, subscriptionItemRepository } from "../src/server/repositories/subscription-repository";
import { invoiceRepository } from "../src/server/repositories/invoice-repository";
import { paymentRepository } from "../src/server/repositories/payment-repository";
import { nextInvoiceNumber } from "../src/lib/billing/invoice-numbering";

async function ensurePlan(input: { key: string; name: string; description: string; sortOrder: number }) {
  const existing = await planRepository.findByKey(input.key);
  if (existing) return existing;
  return planRepository.create({ id: generateId(), key: input.key, name: input.name, description: input.description, sortOrder: input.sortOrder });
}

async function ensurePrice(planId: string, input: { currency: string; unitAmount: number; interval: "MONTH" | "YEAR" }) {
  const existing = (await planPriceRepository.listForPlan(planId)).find((p) => p.currency === input.currency && p.interval === input.interval);
  if (existing) return existing;
  return planPriceRepository.create({ id: generateId(), planId, currency: input.currency, unitAmount: input.unitAmount, interval: input.interval, provider: "STRIPE" });
}

export async function seedBillingFixtures(): Promise<void> {
  const starter = await ensurePlan({ key: "starter", name: "Starter", description: "For a single organization getting started with Alpha OS.", sortOrder: 0 });
  await ensurePrice(starter.id, { currency: "USD", unitAmount: 4900, interval: "MONTH" }); // $49.00/mo
  await ensurePrice(starter.id, { currency: "USD", unitAmount: 49000, interval: "YEAR" }); // $490.00/yr (2 months free)

  const growth = await ensurePlan({ key: "growth", name: "Growth", description: "For growing agencies that need more seats and higher limits.", sortOrder: 1 });
  await ensurePrice(growth.id, { currency: "USD", unitAmount: 19900, interval: "MONTH" }); // $199.00/mo
  await ensurePrice(growth.id, { currency: "USD", unitAmount: 199000, interval: "YEAR" }); // $1,990.00/yr

  console.log("[seed-billing] Plan catalog seeded/verified: Starter, Growth (each with monthly + annual USD pricing).");

  const orgA = await organizationRepository.findBySlug("acme-corp-dev");
  if (!orgA) {
    console.log("[seed-billing] acme-corp-dev not found yet — skipping billing history fixture (run seed-rbac first).");
    return;
  }

  let account = await billingAccountRepository.findByOrganizationId(orgA.id, db);
  if (!account) {
    account = await billingAccountRepository.create({ id: generateId(), organizationId: orgA.id, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_dev_${orgA.id}` }, db);
  }

  const existingSubscription = await subscriptionRepository.findCurrentForOrganization(orgA.id, db);
  const subscription =
    existingSubscription ??
    (await subscriptionRepository.create({ id: generateId(), organizationId: orgA.id, billingAccountId: account.id, provider: "STRIPE", providerSubscriptionId: `sub_dev_${orgA.id}`, status: "ACTIVE" }, db));
  if (!existingSubscription) {
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    await subscriptionRepository.applyProviderState(
      subscription.id,
      { status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, canceledAt: null, trialStart: null, trialEnd: null, providerEventTimestamp: now },
      db,
    );
    const growthMonthly = (await planPriceRepository.listForPlan(growth.id)).find((p) => p.interval === "MONTH");
    if (growthMonthly) {
      await subscriptionItemRepository.create({ id: generateId(), subscriptionId: subscription.id, planPriceId: growthMonthly.id, quantity: 1, provider: "STRIPE", providerItemId: `si_dev_${subscription.id}` }, db);
    }
  }

  const existingInvoices = await invoiceRepository.listForOrganization(orgA.id, { limit: 1 }, {}, db);
  if (existingInvoices.items.length === 0) {
    const invoiceNumber = await nextInvoiceNumber(db);
    const invoice = await invoiceRepository.create(
      {
        id: generateId(),
        organizationId: orgA.id,
        billingAccountId: account.id,
        subscriptionId: subscription.id,
        invoiceNumber,
        status: "PAID",
        currency: "USD",
        subtotal: 19900,
        discountTotal: 0,
        taxTotal: 0,
        total: 19900,
        amountPaid: 19900,
        amountDue: 0,
        issueDate: new Date(),
        paidAt: new Date(),
        provider: "STRIPE",
        providerInvoiceId: `in_dev_${generateId()}`,
      },
      db,
    );
    await invoiceRepository.addLineItem(
      { id: generateId(), invoiceId: invoice.id, description: "Growth — monthly", quantity: 1, unitAmount: 19900, subtotal: 19900, discountAmount: 0, taxAmount: 0, total: 19900 },
      db,
    );
    await paymentRepository.create(
      {
        id: generateId(),
        organizationId: orgA.id,
        billingAccountId: account.id,
        invoiceId: invoice.id,
        amount: 19900,
        currency: "USD",
        status: "SUCCEEDED",
        provider: "STRIPE",
        providerPaymentId: `pi_dev_${generateId()}`,
        paymentMethodType: "card",
        paymentMethodBrand: "visa",
        paymentMethodLast4: "4242",
        paidAt: new Date(),
      },
      db,
    );
  }

  console.log("[seed-billing] Billing history fixture seeded/verified for Acme Corp: 1 subscription, 1 paid invoice, 1 payment.");
}
