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
import { paymentRepository, refundRepository } from "../src/server/repositories/payment-repository";
import { creditLedgerRepository } from "../src/server/repositories/credit-ledger-repository";
import { auditEventRepository } from "../src/server/repositories/audit-event-repository";
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
  // A EUR price on Starter (Module 15 spec §14) — so the multi-currency
  // grouping in every reporting service has a REAL second currency to
  // group, not just a theoretical code path. Deliberately just ONE
  // additional currency on ONE plan, not a full EUR catalog — the
  // minimum needed to prove currencies are never summed together.
  await ensurePrice(starter.id, { currency: "EUR", unitAmount: 4500, interval: "MONTH" }); // €45.00/mo

  console.log("[seed-billing] Plan catalog seeded/verified: Starter (USD+EUR monthly, USD annual), Growth (USD monthly+annual).");

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

  // `currency === "USD"` is REQUIRED here, not defensive decoration —
  // Module 15 added a second (EUR) monthly Starter price above, so a
  // bare `interval === "MONTH"` filter is no longer unambiguous and
  // `.find()`'s result depends on array order, which is NOT guaranteed
  // to put USD first. A real bug (found by inspecting this exact
  // fixture set's own live output, not by reading the code): every
  // fixture below sharing this ONE `starterMonthly` binding briefly
  // resolved to the EUR price instead, silently putting Epsilon/Kappa/
  // Theta's own Starter-priced subscriptions in the wrong currency.
  const starterMonthly = (await planPriceRepository.listForPlan(starter.id)).find((p) => p.interval === "MONTH" && p.currency === "USD");

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

  // ======================================================================
  // Module 15 — additional fixtures for financial intelligence/reporting:
  // a canceled (churned) organization, an expanding one, a contracting
  // one, a reactivated one, and a non-USD organization. None of these
  // touch Org A/B/C/D's own existing rows (spec §27: "never corrupting
  // existing fixtures").
  // ======================================================================
  const growthMonthly = (await planPriceRepository.listForPlan(growth.id)).find((p) => p.interval === "MONTH" && p.currency === "USD");
  const starterEurMonthly = (await planPriceRepository.listForPlan(starter.id)).find((p) => p.interval === "MONTH" && p.currency === "EUR");
  if (!starterMonthly || !growthMonthly) {
    console.log("[seed-billing] Starter/Growth USD monthly prices not found — skipping Module 15 movement/currency fixtures.");
    return;
  }

  // --- Epsilon Analytics — a CANCELED subscription (churn fixture). Its
  // SubscriptionItem is left in place (never deleted on cancellation —
  // spec §28), so its final MRR contribution before churn is still
  // exactly reconstructible from real data (movement.ts's own churn
  // classification).
  const orgEId = await ensureOrganization({ slug: "epsilon-analytics-dev", name: "Epsilon Analytics", displayName: "Epsilon Analytics" });
  await ensureMember(orgEId, "owner-e@alpha-os.test", "Owner E (Dev)", "owner");
  {
    let accountE = await billingAccountRepository.findByOrganizationId(orgEId, db);
    if (!accountE) accountE = await billingAccountRepository.create({ id: generateId(), organizationId: orgEId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_dev_${orgEId}` }, db);

    const existingSubE = await subscriptionRepository.findCurrentForOrganization(orgEId, db);
    if (!existingSubE) {
      const subscriptionE = await subscriptionRepository.create({ id: generateId(), organizationId: orgEId, billingAccountId: accountE.id, provider: "STRIPE", providerSubscriptionId: `sub_dev_${orgEId}`, status: "ACTIVE" }, db);
      await subscriptionItemRepository.create({ id: generateId(), subscriptionId: subscriptionE.id, planPriceId: starterMonthly.id, quantity: 1, provider: "STRIPE", providerItemId: `si_dev_${subscriptionE.id}` }, db);
      // Canceled moments after creation (still lands within "today"/
      // "current_month" for the movement engine's own period query —
      // `AuditEvent.createdAt`/`Subscription.createdAt` are both
      // server-generated-now by design, see billing-intelligence.md
      // "Seed fixtures and server-generated timestamps").
      await subscriptionRepository.applyProviderState(
        subscriptionE.id,
        { status: "CANCELED", currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, canceledAt: new Date(), trialStart: null, trialEnd: null, providerEventTimestamp: new Date() },
        db,
      );
      console.log("[seed-billing] Billing history fixture seeded for Epsilon Analytics: 1 CANCELED subscription (churn fixture).");
    }
  }

  // --- Zeta Growth — EXPANSION (Starter -> Growth), plus a credit
  // balance and a refunded one-time payment. A real `billing.plan.
  // changed` audit event is written directly (the same shape
  // `changeSubscriptionPlan()` itself produces) so the MRR movement
  // engine has a genuine historical fact to classify from — never a
  // fabricated movement row.
  const orgZId = await ensureOrganization({ slug: "zeta-growth-dev", name: "Zeta Growth", displayName: "Zeta Growth" });
  await ensureMember(orgZId, "owner-z@alpha-os.test", "Owner Z (Dev)", "owner");
  {
    let accountZ = await billingAccountRepository.findByOrganizationId(orgZId, db);
    if (!accountZ) accountZ = await billingAccountRepository.create({ id: generateId(), organizationId: orgZId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_dev_${orgZId}` }, db);

    const existingSubZ = await subscriptionRepository.findCurrentForOrganization(orgZId, db);
    if (!existingSubZ) {
      const subscriptionZ = await subscriptionRepository.create({ id: generateId(), organizationId: orgZId, billingAccountId: accountZ.id, provider: "STRIPE", providerSubscriptionId: `sub_dev_${orgZId}`, status: "ACTIVE" }, db);
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      await subscriptionRepository.applyProviderState(subscriptionZ.id, { status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, canceledAt: null, trialStart: null, trialEnd: null, providerEventTimestamp: now }, db);
      const item = await subscriptionItemRepository.create({ id: generateId(), subscriptionId: subscriptionZ.id, planPriceId: starterMonthly.id, quantity: 1, provider: "STRIPE", providerItemId: `si_dev_${subscriptionZ.id}` }, db);

      // The historical plan-change fact.
      await auditEventRepository.create(
        {
          id: generateId(),
          organizationId: orgZId,
          actorType: "SYSTEM",
          actorUserId: null,
          actorServiceId: null,
          actorDisplayName: "Dev fixture",
          action: "billing.plan.changed",
          category: "BILLING",
          outcome: "SUCCESS",
          resourceType: "subscription",
          resourceName: null,
          resourceId: subscriptionZ.id,
          previousState: { planPriceId: starterMonthly.id },
          newState: { planPriceId: growthMonthly.id },
          metadata: { seedFixture: true },
          ipAddress: null,
          userAgent: null,
          requestId: generateId(),
          correlationId: generateId(),
        },
        db,
      );
      // ...then the item itself is updated to reflect that CURRENT state
      // — exactly what `billing-webhook-service.ts`'s own reconciliation
      // does after a real Stripe plan-change event (Module 15's own
      // fix — see that file's top comment).
      await subscriptionItemRepository.update(item.id, { planPriceId: growthMonthly.id }, db);

      // A credit balance and a refunded one-time payment — Zeta also
      // doubles as the credit-ledger/refund-reporting fixture, rather
      // than proliferating a fifth organization for it.
      await creditLedgerRepository.create({ id: generateId(), organizationId: orgZId, billingAccountId: accountZ.id, type: "CREDIT", amount: 2500, currency: "USD", reason: "Goodwill credit — onboarding delay (dev fixture)" }, db);

      const oneTimePayment = await paymentRepository.create(
        { id: generateId(), organizationId: orgZId, billingAccountId: accountZ.id, amount: 5000, currency: "USD", status: "REFUNDED", provider: "STRIPE", providerPaymentId: `pi_dev_refunded_${generateId()}`, paymentMethodType: "card", paymentMethodBrand: "visa", paymentMethodLast4: "4242", paidAt: now },
        db,
      );
      await refundRepository.create({ id: generateId(), paymentId: oneTimePayment.id, amount: 5000, currency: "USD", reason: "Duplicate charge (dev fixture)", status: "SUCCEEDED", provider: "STRIPE", providerRefundId: `re_dev_${generateId()}` }, db);

      console.log("[seed-billing] Billing history fixture seeded for Zeta Growth: Starter->Growth EXPANSION, 1 credit, 1 refunded payment.");
    }
  }

  // --- Theta Retail — CONTRACTION (Growth -> Starter), the mirror of Zeta.
  const orgTId = await ensureOrganization({ slug: "theta-retail-dev", name: "Theta Retail", displayName: "Theta Retail" });
  await ensureMember(orgTId, "owner-t@alpha-os.test", "Owner T (Dev)", "owner");
  {
    let accountT = await billingAccountRepository.findByOrganizationId(orgTId, db);
    if (!accountT) accountT = await billingAccountRepository.create({ id: generateId(), organizationId: orgTId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_dev_${orgTId}` }, db);

    const existingSubT = await subscriptionRepository.findCurrentForOrganization(orgTId, db);
    if (!existingSubT) {
      const subscriptionT = await subscriptionRepository.create({ id: generateId(), organizationId: orgTId, billingAccountId: accountT.id, provider: "STRIPE", providerSubscriptionId: `sub_dev_${orgTId}`, status: "ACTIVE" }, db);
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      await subscriptionRepository.applyProviderState(subscriptionT.id, { status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, canceledAt: null, trialStart: null, trialEnd: null, providerEventTimestamp: now }, db);
      const item = await subscriptionItemRepository.create({ id: generateId(), subscriptionId: subscriptionT.id, planPriceId: growthMonthly.id, quantity: 1, provider: "STRIPE", providerItemId: `si_dev_${subscriptionT.id}` }, db);

      await auditEventRepository.create(
        {
          id: generateId(),
          organizationId: orgTId,
          actorType: "SYSTEM",
          actorUserId: null,
          actorServiceId: null,
          actorDisplayName: "Dev fixture",
          action: "billing.plan.changed",
          category: "BILLING",
          outcome: "SUCCESS",
          resourceType: "subscription",
          resourceName: null,
          resourceId: subscriptionT.id,
          previousState: { planPriceId: growthMonthly.id },
          newState: { planPriceId: starterMonthly.id },
          metadata: { seedFixture: true },
          ipAddress: null,
          userAgent: null,
          requestId: generateId(),
          correlationId: generateId(),
        },
        db,
      );
      await subscriptionItemRepository.update(item.id, { planPriceId: starterMonthly.id }, db);
      console.log("[seed-billing] Billing history fixture seeded for Theta Retail: Growth->Starter CONTRACTION.");
    }
  }

  // --- Kappa Renewed — REACTIVATION: an earlier subscription that
  // churned, then a genuinely NEW one for the same organization.
  const orgKId = await ensureOrganization({ slug: "kappa-renewed-dev", name: "Kappa Renewed", displayName: "Kappa Renewed" });
  await ensureMember(orgKId, "owner-k@alpha-os.test", "Owner K (Dev)", "owner");
  {
    let accountK = await billingAccountRepository.findByOrganizationId(orgKId, db);
    if (!accountK) accountK = await billingAccountRepository.create({ id: generateId(), organizationId: orgKId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_dev_${orgKId}` }, db);

    const existingSubsK = await subscriptionRepository.listForOrganization(orgKId, db);
    if (existingSubsK.length === 0) {
      const churned = await subscriptionRepository.create({ id: generateId(), organizationId: orgKId, billingAccountId: accountK.id, provider: "STRIPE", providerSubscriptionId: `sub_dev_churned_${orgKId}`, status: "ACTIVE" }, db);
      await subscriptionItemRepository.create({ id: generateId(), subscriptionId: churned.id, planPriceId: starterMonthly.id, quantity: 1, provider: "STRIPE", providerItemId: `si_dev_${churned.id}` }, db);
      await subscriptionRepository.applyProviderState(
        churned.id,
        { status: "CANCELED", currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, canceledAt: new Date(), trialStart: null, trialEnd: null, providerEventTimestamp: new Date() },
        db,
      );

      // Created strictly AFTER the churned row above — real, sequential
      // inserts, never a backdated timestamp (Subscription.createdAt is
      // server-generated, same "never fake history" discipline as
      // AuditEvent — see this block's own top comment).
      const reactivated = await subscriptionRepository.create({ id: generateId(), organizationId: orgKId, billingAccountId: accountK.id, provider: "STRIPE", providerSubscriptionId: `sub_dev_reactivated_${orgKId}`, status: "ACTIVE" }, db);
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      await subscriptionRepository.applyProviderState(reactivated.id, { status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, canceledAt: null, trialStart: null, trialEnd: null, providerEventTimestamp: now }, db);
      await subscriptionItemRepository.create({ id: generateId(), subscriptionId: reactivated.id, planPriceId: starterMonthly.id, quantity: 1, provider: "STRIPE", providerItemId: `si_dev_${reactivated.id}` }, db);
      console.log("[seed-billing] Billing history fixture seeded for Kappa Renewed: 1 CANCELED + 1 new ACTIVE subscription (reactivation fixture).");
    }
  }

  // --- Lambda Europe — a non-USD organization (EUR), so every
  // currency-grouping code path in the reporting layer has a genuine
  // second currency to group rather than an untested code path.
  if (starterEurMonthly) {
    const orgLId = await ensureOrganization({ slug: "lambda-europe-dev", name: "Lambda Europe", displayName: "Lambda Europe" });
    await ensureMember(orgLId, "owner-l@alpha-os.test", "Owner L (Dev)", "owner");
    let accountL = await billingAccountRepository.findByOrganizationId(orgLId, db);
    if (!accountL) accountL = await billingAccountRepository.create({ id: generateId(), organizationId: orgLId, currency: "EUR", provider: "STRIPE", providerCustomerId: `cus_dev_${orgLId}` }, db);

    const existingSubL = await subscriptionRepository.findCurrentForOrganization(orgLId, db);
    if (!existingSubL) {
      const subscriptionL = await subscriptionRepository.create({ id: generateId(), organizationId: orgLId, billingAccountId: accountL.id, provider: "STRIPE", providerSubscriptionId: `sub_dev_${orgLId}`, status: "ACTIVE" }, db);
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      await subscriptionRepository.applyProviderState(subscriptionL.id, { status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, canceledAt: null, trialStart: null, trialEnd: null, providerEventTimestamp: now }, db);
      await subscriptionItemRepository.create({ id: generateId(), subscriptionId: subscriptionL.id, planPriceId: starterEurMonthly.id, quantity: 1, provider: "STRIPE", providerItemId: `si_dev_${subscriptionL.id}` }, db);
      console.log("[seed-billing] Billing history fixture seeded for Lambda Europe: 1 ACTIVE EUR subscription (currency-grouping fixture).");
    }
  }
}
