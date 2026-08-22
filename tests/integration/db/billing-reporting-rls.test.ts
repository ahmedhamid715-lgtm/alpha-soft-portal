import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { subscriptionRepository, subscriptionItemRepository } from "@/server/repositories/subscription-repository";
import { invoiceRepository } from "@/server/repositories/invoice-repository";
import { paymentRepository } from "@/server/repositories/payment-repository";
import { creditLedgerRepository } from "@/server/repositories/credit-ledger-repository";
import { planRepository, planPriceRepository } from "@/server/repositories/plan-repository";
import { nextInvoiceNumber } from "@/lib/billing/invoice-numbering";

/**
 * Module 15's own new repository methods (`listWithPricedItems()`,
 * `listOpenForAging()`, `sumBilledByCurrency()`, `sumCollectedByCurrency()`,
 * `listAll()`, ...) all follow the SAME shape: `scope: {organizationId}
 * | {platform: true}`, and for the `{platform: true}` branch the
 * application-level `WHERE` clause is deliberately EMPTY — RLS alone is
 * what's supposed to make an org-scoped (non-platform) tenant context
 * only ever see its own rows, even calling the EXACT SAME repository
 * method a platform-wide report uses. This is precisely the
 * "zero-WHERE billing queries remain tenant-scoped" adversarial proof
 * spec §21/§26 demands — proven here directly against the real,
 * restricted `alpha_os_app` role, never a superuser, never mocked.
 *
 * `billing-rls.test.ts` (Module 13) already proves RLS holds for plain
 * `tx.<model>.findMany()` calls against these same tables — this file
 * is deliberately narrower: it proves Module 15's OWN new repository
 * methods (which are the ones a caller could get wrong by forgetting a
 * `WHERE`) inherit that same guarantee, not a re-proof of RLS itself.
 */
describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Billing reporting repositories — Row-Level Security (database integration)", () => {
  const orgIds: string[] = [];
  const planIds: string[] = [];
  let orgAId: string;
  let orgBId: string;

  async function seedOrgs() {
    orgAId = generateId();
    orgBId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Reporting RLS Org A", displayName: "Reporting RLS Org A", slug: `reporting-rls-org-a-${orgAId}` });
    await organizationRepository.create({ id: orgBId, name: "Reporting RLS Org B", displayName: "Reporting RLS Org B", slug: `reporting-rls-org-b-${orgBId}` });
    orgIds.push(orgAId, orgBId);
  }

  afterEach(async () => {
    await db.subscriptionItem.deleteMany({ where: { subscription: { organizationId: { in: orgIds } } } });
    await db.subscription.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.invoice.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.payment.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.creditLedgerEntry.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.billingAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    if (planIds.length) await db.plan.deleteMany({ where: { id: { in: planIds } } });
    orgIds.length = 0;
    planIds.length = 0;
  });

  it("subscriptionRepository.listWithPricedItems({platform: true}) under Org B's own (non-platform) tenant context returns ONLY Org B's subscriptions, never Org A's — even though the application-level WHERE clause for this scope is empty", async () => {
    await seedOrgs();
    const plan = await planRepository.create({ id: generateId(), key: `rls_plan_${generateId().replace(/-/g, "_")}`.slice(0, 40), name: "RLS Test Plan" });
    planIds.push(plan.id);
    const price = await planPriceRepository.create({ id: generateId(), planId: plan.id, currency: "USD", unitAmount: 1000, interval: "MONTH", provider: "STRIPE" });

    for (const organizationId of [orgAId, orgBId]) {
      const account = await withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
        billingAccountRepository.create({ id: generateId(), organizationId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_rls_reporting_${generateId()}` }, tx),
      );
      const subscription = await withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
        subscriptionRepository.create({ id: generateId(), organizationId, billingAccountId: account.id, provider: "STRIPE", providerSubscriptionId: `sub_rls_reporting_${generateId()}`, status: "ACTIVE" }, tx),
      );
      await withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
        subscriptionItemRepository.create({ id: generateId(), subscriptionId: subscription.id, planPriceId: price.id, quantity: 1, provider: "STRIPE", providerItemId: `si_rls_reporting_${generateId()}` }, tx),
      );
    }

    // The critical assertion: an org-scoped (non-platform) tenant
    // context calling the SAME method a platform report uses, with
    // `{ platform: true }` as the scope argument — RLS alone must still
    // confine the result to Org B's own row.
    const seenByOrgB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => subscriptionRepository.listWithPricedItems({ platform: true }, tx));
    expect(seenByOrgB.map((s) => s.organizationId)).toEqual([orgBId]);

    // And the real platform context genuinely sees both.
    const seenByPlatform = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) => subscriptionRepository.listWithPricedItems({ platform: true }, tx));
    expect(seenByPlatform.some((s) => s.organizationId === orgAId)).toBe(true);
    expect(seenByPlatform.some((s) => s.organizationId === orgBId)).toBe(true);
  });

  it("invoiceRepository.listOpenForAging({platform: true}) under Org B's own tenant context never returns Org A's invoices", async () => {
    await seedOrgs();
    for (const organizationId of [orgAId, orgBId]) {
      const account = await withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
        billingAccountRepository.create({ id: generateId(), organizationId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_rls_aging_${generateId()}` }, tx),
      );
      const invoiceNumber = await nextInvoiceNumber();
      await withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
        invoiceRepository.create(
          { id: generateId(), organizationId, billingAccountId: account.id, invoiceNumber, status: "OPEN", currency: "USD", subtotal: 1000, discountTotal: 0, taxTotal: 0, total: 1000, amountPaid: 0, amountDue: 1000, issueDate: new Date(), provider: "STRIPE" },
          tx,
        ),
      );
    }

    const seenByOrgB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => invoiceRepository.listOpenForAging({ platform: true }, tx));
    expect(seenByOrgB.map((i) => i.organizationId)).toEqual([orgBId]);
  });

  it("paymentRepository.sumCollectedByCurrency({platform: true}) under Org B's own tenant context only sums Org B's own payments", async () => {
    await seedOrgs();
    const now = new Date();
    for (const [organizationId, amount] of [[orgAId, 7000] as const, [orgBId, 3000] as const]) {
      const account = await withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
        billingAccountRepository.create({ id: generateId(), organizationId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_rls_collected_${generateId()}` }, tx),
      );
      await withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
        paymentRepository.create({ id: generateId(), organizationId, billingAccountId: account.id, amount, currency: "USD", status: "SUCCEEDED", provider: "STRIPE", providerPaymentId: `pi_rls_collected_${generateId()}`, paidAt: now }, tx),
      );
    }

    const seenByOrgB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) =>
      paymentRepository.sumCollectedByCurrency({ platform: true }, { start: new Date(now.getTime() - 60_000), end: new Date(now.getTime() + 60_000) }, tx),
    );
    expect(seenByOrgB).toEqual([{ currency: "USD", amount: 3000, paymentCount: 1 }]); // never Org A's 7000
  });

  it("creditLedgerRepository.listAll({platform: true}) under Org B's own tenant context never returns Org A's credit ledger entries", async () => {
    await seedOrgs();
    for (const organizationId of [orgAId, orgBId]) {
      const account = await withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
        billingAccountRepository.create({ id: generateId(), organizationId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_rls_credit_${generateId()}` }, tx),
      );
      await withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
        creditLedgerRepository.create({ id: generateId(), organizationId, billingAccountId: account.id, type: "CREDIT", amount: 500, currency: "USD", reason: "RLS test" }, tx),
      );
    }

    const seenByOrgB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => creditLedgerRepository.listAll({ platform: true }, tx));
    expect(seenByOrgB.map((e) => e.organizationId)).toEqual([orgBId]);
  });

  it("a context with NO organization and NO platform staff flag (fails closed) sees NOTHING, even for {platform: true} scope", async () => {
    await seedOrgs();
    const account = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_rls_failclosed_${generateId()}` }, tx),
    );
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: account.id, provider: "STRIPE", providerSubscriptionId: `sub_rls_failclosed_${generateId()}`, status: "ACTIVE" }, tx),
    );

    const seenByNobody = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) => subscriptionRepository.listWithPricedItems({ platform: true }, tx));
    expect(seenByNobody).toEqual([]);
  });
});
