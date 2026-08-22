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
 * Also seeds realistic billing history across the THREE tenants Module
 * 14's own spec (§46) calls for, each in a genuinely different billing
 * state so every status/health branch has real data to render against
 * in a fresh dev environment with no Stripe account configured at all:
 *
 *   - Org A (`acme-corp-dev`, pre-existing from Module 13) — ACTIVE,
 *     paid, PLUS a second subscription-owning org with a
 *     scheduled-at-period-end cancellation (`gamma-shipping-dev`,
 *     Module 14) — `cancelAtPeriodEnd: true` on an otherwise-ACTIVE
 *     subscription, exactly the state `resumeSubscription()` undoes.
 *   - Org B (`beta-industries-dev`, pre-existing from Module 05) —
 *     TRIALING with one OPEN (pending) invoice.
 *   - Org C (`delta-consulting-dev`, new — Module 14) — PAST_DUE
 *     subscription + one FAILED payment on an OPEN invoice.
 *
 * All with fake-but-honestly-shaped provider ids (`cus_dev_...`, never a
 * real Stripe object — spec §38: never mirror provider identity the
 * platform doesn't actually control).
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
import { ensureOrganization, ensureMember } from "./seed-rbac";

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

  const starterMonthly = (await planPriceRepository.listForPlan(starter.id)).find((p) => p.interval === "MONTH");

  // --- Org B ("Beta Industries", pre-existing from seed-rbac.ts) —
  // TRIALING subscription + one OPEN (pending) invoice. Proves the
  // trial/health UI branches (`computeBillingHealth()` → "trial") and
  // the customer's "pending invoice" view without any paid history.
  const orgB = await organizationRepository.findBySlug("beta-industries-dev");
  if (orgB && starterMonthly) {
    let accountB = await billingAccountRepository.findByOrganizationId(orgB.id, db);
    if (!accountB) {
      accountB = await billingAccountRepository.create({ id: generateId(), organizationId: orgB.id, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_dev_${orgB.id}` }, db);
    }

    const existingSubB = await subscriptionRepository.findCurrentForOrganization(orgB.id, db);
    const subscriptionB =
      existingSubB ??
      (await subscriptionRepository.create({ id: generateId(), organizationId: orgB.id, billingAccountId: accountB.id, provider: "STRIPE", providerSubscriptionId: `sub_dev_${orgB.id}`, status: "TRIALING" }, db));
    if (!existingSubB) {
      const now = new Date();
      const trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + 14);
      await subscriptionRepository.applyProviderState(
        subscriptionB.id,
        { status: "TRIALING", currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, canceledAt: null, trialStart: now, trialEnd, providerEventTimestamp: now },
        db,
      );
      await subscriptionItemRepository.create({ id: generateId(), subscriptionId: subscriptionB.id, planPriceId: starterMonthly.id, quantity: 1, provider: "STRIPE", providerItemId: `si_dev_${subscriptionB.id}` }, db);
    }

    const existingInvoicesB = await invoiceRepository.listForOrganization(orgB.id, { limit: 1 }, {}, db);
    if (existingInvoicesB.items.length === 0) {
      const invoiceNumberB = await nextInvoiceNumber(db);
      const invoiceB = await invoiceRepository.create(
        {
          id: generateId(),
          organizationId: orgB.id,
          billingAccountId: accountB.id,
          subscriptionId: subscriptionB.id,
          invoiceNumber: invoiceNumberB,
          status: "OPEN",
          currency: "USD",
          subtotal: 4900,
          discountTotal: 0,
          taxTotal: 0,
          total: 4900,
          amountPaid: 0,
          amountDue: 4900,
          issueDate: new Date(),
          provider: "STRIPE",
          providerInvoiceId: `in_dev_${generateId()}`,
        },
        db,
      );
      await invoiceRepository.addLineItem(
        { id: generateId(), invoiceId: invoiceB.id, description: "Starter — monthly (trial)", quantity: 1, unitAmount: 4900, subtotal: 4900, discountAmount: 0, taxAmount: 0, total: 4900 },
        db,
      );
    }
    console.log("[seed-billing] Billing history fixture seeded/verified for Beta Industries: 1 TRIALING subscription, 1 open (pending) invoice.");
  }

  // --- Org C ("Delta Consulting", new — Module 14 spec §46) —
  // PAST_DUE subscription + a FAILED payment on an OPEN invoice. A
  // fresh organization (not reused from Module 05's RBAC fixtures)
  // since none of those already models this billing state.
  const orgCId = await ensureOrganization({ slug: "delta-consulting-dev", name: "Delta Consulting", displayName: "Delta Consulting" });
  await ensureMember(orgCId, "owner-c@alpha-os.test", "Owner C (Dev)", "owner");
  await ensureMember(orgCId, "admin-c@alpha-os.test", "Admin C (Dev)", "admin");
  await ensureMember(orgCId, "member-c@alpha-os.test", "Member C (Dev)", "member");

  if (starterMonthly) {
    let accountC = await billingAccountRepository.findByOrganizationId(orgCId, db);
    if (!accountC) {
      accountC = await billingAccountRepository.create({ id: generateId(), organizationId: orgCId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_dev_${orgCId}` }, db);
    }
    if (accountC.status !== "PAST_DUE") {
      accountC = await billingAccountRepository.updateStatus(accountC.id, "PAST_DUE", db);
    }

    const existingSubC = await subscriptionRepository.findCurrentForOrganization(orgCId, db);
    const subscriptionC =
      existingSubC ??
      (await subscriptionRepository.create({ id: generateId(), organizationId: orgCId, billingAccountId: accountC.id, provider: "STRIPE", providerSubscriptionId: `sub_dev_${orgCId}`, status: "PAST_DUE" }, db));
    if (!existingSubC) {
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      const periodStart = new Date(now);
      periodStart.setMonth(periodStart.getMonth() - 1);
      await subscriptionRepository.applyProviderState(
        subscriptionC.id,
        { status: "PAST_DUE", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, canceledAt: null, trialStart: null, trialEnd: null, providerEventTimestamp: now },
        db,
      );
      await subscriptionItemRepository.create({ id: generateId(), subscriptionId: subscriptionC.id, planPriceId: starterMonthly.id, quantity: 1, provider: "STRIPE", providerItemId: `si_dev_${subscriptionC.id}` }, db);
    }

    const existingInvoicesC = await invoiceRepository.listForOrganization(orgCId, { limit: 1 }, {}, db);
    let invoiceC = existingInvoicesC.items[0];
    if (!invoiceC) {
      const invoiceNumberC = await nextInvoiceNumber(db);
      invoiceC = await invoiceRepository.create(
        {
          id: generateId(),
          organizationId: orgCId,
          billingAccountId: accountC.id,
          subscriptionId: subscriptionC.id,
          invoiceNumber: invoiceNumberC,
          status: "OPEN",
          currency: "USD",
          subtotal: 4900,
          discountTotal: 0,
          taxTotal: 0,
          total: 4900,
          amountPaid: 0,
          amountDue: 4900,
          issueDate: new Date(),
          provider: "STRIPE",
          providerInvoiceId: `in_dev_${generateId()}`,
        },
        db,
      );
      await invoiceRepository.addLineItem(
        { id: generateId(), invoiceId: invoiceC.id, description: "Starter — monthly", quantity: 1, unitAmount: 4900, subtotal: 4900, discountAmount: 0, taxAmount: 0, total: 4900 },
        db,
      );
    }

    const existingPaymentsC = await paymentRepository.listForOrganization(orgCId, { limit: 1 }, db);
    if (existingPaymentsC.items.length === 0) {
      await paymentRepository.create(
        {
          id: generateId(),
          organizationId: orgCId,
          billingAccountId: accountC.id,
          invoiceId: invoiceC.id,
          amount: 4900,
          currency: "USD",
          status: "FAILED",
          provider: "STRIPE",
          providerPaymentId: `pi_dev_${generateId()}`,
          paymentMethodType: "card",
          paymentMethodBrand: "visa",
          paymentMethodLast4: "0002", // Stripe's own documented "generic decline" test PAN suffix
          failureCode: "card_declined",
          failureMessage: "Your card was declined.",
        },
        db,
      );
    }
    console.log("[seed-billing] Billing history fixture seeded/verified for Delta Consulting: 1 PAST_DUE subscription, 1 open invoice, 1 failed payment.");
  }

  // --- Org A also gets a SECOND, distinct organization
  // ("Gamma Shipping", new — Module 14) with a scheduled-at-period-end
  // cancellation: `cancelAtPeriodEnd: true` on an otherwise-ACTIVE
  // subscription — the exact state `resumeSubscription()` undoes and
  // the customer billing UI must render as "cancels on <date>," not
  // "canceled" (spec §28/§46).
  const orgDId = await ensureOrganization({ slug: "gamma-shipping-dev", name: "Gamma Shipping", displayName: "Gamma Shipping" });
  await ensureMember(orgDId, "owner-d@alpha-os.test", "Owner D (Dev)", "owner");

  if (starterMonthly) {
    let accountD = await billingAccountRepository.findByOrganizationId(orgDId, db);
    if (!accountD) {
      accountD = await billingAccountRepository.create({ id: generateId(), organizationId: orgDId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_dev_${orgDId}` }, db);
    }

    const existingSubD = await subscriptionRepository.findCurrentForOrganization(orgDId, db);
    const subscriptionD =
      existingSubD ??
      (await subscriptionRepository.create({ id: generateId(), organizationId: orgDId, billingAccountId: accountD.id, provider: "STRIPE", providerSubscriptionId: `sub_dev_${orgDId}`, status: "ACTIVE" }, db));
    if (!existingSubD) {
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      await subscriptionRepository.applyProviderState(
        subscriptionD.id,
        { status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: true, canceledAt: null, trialStart: null, trialEnd: null, providerEventTimestamp: now },
        db,
      );
      await subscriptionItemRepository.create({ id: generateId(), subscriptionId: subscriptionD.id, planPriceId: starterMonthly.id, quantity: 1, provider: "STRIPE", providerItemId: `si_dev_${subscriptionD.id}` }, db);
    }
    console.log("[seed-billing] Billing history fixture seeded/verified for Gamma Shipping: 1 ACTIVE subscription scheduled to cancel at period end.");
  }
}
