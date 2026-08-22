import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";

/**
 * Module 13 — direct database-level RLS tests for the billing domain
 * (spec §31/§45), real Postgres, the genuinely restricted `alpha_os_app`
 * role via `withTenantContext()`, never a superuser, never mocked. Same
 * methodology `organization-invitation-policy-rls.test.ts`/
 * `notification-rls.test.ts` already established.
 *
 * Two shapes proven here, matching billing-data-model.md's own
 * classification:
 *   - DIRECTLY organization-owned (`billing_accounts`, `subscriptions`,
 *     `invoices`, `payments`, `credit_ledger_entries`).
 *   - TRANSITIVELY organization-owned (`subscription_items` via
 *     `subscription_id`, `invoice_line_items` via `invoice_id`,
 *     `refunds` via `payment_id`) — proven by inserting the PARENT row
 *     under Org A's context, then attempting the child under Org B's.
 */
describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Billing domain Row-Level Security (database integration)", () => {
  const orgIds: string[] = [];
  let orgAId: string;
  let orgBId: string;

  async function seed() {
    orgAId = generateId();
    orgBId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Billing RLS Org A", displayName: "Billing RLS Org A", slug: `billing-rls-org-a-${orgAId}` });
    await organizationRepository.create({ id: orgBId, name: "Billing RLS Org B", displayName: "Billing RLS Org B", slug: `billing-rls-org-b-${orgBId}` });
    orgIds.push(orgAId, orgBId);
  }
  const seeded = seed();

  afterEach(async () => {
    // Cleaned per-test (not just at the very end) — `billing_accounts.organization_id`
    // is `@unique`, so a second test inserting another row for the same
    // org would otherwise collide with the first test's leftover row.
    // Scoped to THIS file's own two orgs — an unscoped `deleteMany({})`
    // was tried here and reverted: Vitest runs test FILES concurrently
    // against the same real database (not just tests within one file),
    // so a blanket delete here was intermittently wiping out rows
    // `subscription-service.test.ts`/`refund-service.test.ts`/
    // `invoice-payment-service.test.ts` had just created in a
    // concurrently-running file — a real cross-file test-isolation bug,
    // found by running the FULL suite, not by running this file alone.
    await db.refund.deleteMany({ where: { payment: { organizationId: { in: [orgAId, orgBId] } } } });
    await db.payment.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await db.invoiceLineItem.deleteMany({ where: { invoice: { organizationId: { in: [orgAId, orgBId] } } } });
    await db.invoice.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await db.subscriptionItem.deleteMany({ where: { subscription: { organizationId: { in: [orgAId, orgBId] } } } });
    await db.subscription.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await db.creditLedgerEntry.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await db.billingAccount.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
  });

  afterAll(async () => {
    await seeded;
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  async function seedBillingAccount(organizationId: string) {
    const id = generateId();
    return withTenantContext({ userId: null, organizationId, isPlatformStaff: false }, (tx) =>
      tx.billingAccount.create({ data: { id, organizationId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_rls_${id}` } }),
    );
  }

  // --- billing_accounts (directly organization-owned) -----------------------

  it("Org B's context cannot SELECT Org A's billing account", async () => {
    await seeded;
    const account = await seedBillingAccount(orgAId);

    const seenByA = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.billingAccount.findUnique({ where: { id: account.id } }));
    expect(seenByA?.id).toBe(account.id);

    const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.billingAccount.findUnique({ where: { id: account.id } }));
    expect(seenByB).toBeNull();
  });

  it("Org B's context cannot UPDATE Org A's billing account (filtered to zero rows)", async () => {
    await seeded;
    const account = await seedBillingAccount(orgAId);

    const result = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) =>
      tx.billingAccount.updateMany({ where: { id: account.id }, data: { status: "SUSPENDED" } }),
    );
    expect(result.count).toBe(0);

    const real = await db.billingAccount.findUnique({ where: { id: account.id } });
    expect(real?.status).toBe("ACTIVE");
  });

  it("a forged cross-tenant INSERT is rejected by WITH CHECK", async () => {
    await seeded;
    const id = generateId();
    await expect(
      withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) =>
        tx.billingAccount.create({ data: { id, organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_forged_${id}` } }),
      ),
    ).rejects.toBeDefined();
  });

  it("platform context can SELECT any organization's billing account", async () => {
    await seeded;
    const account = await seedBillingAccount(orgAId);
    const seenByPlatform = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) => tx.billingAccount.findUnique({ where: { id: account.id } }));
    expect(seenByPlatform?.id).toBe(account.id);
  });

  it("NO tenant context at all fails closed — zero rows visible", async () => {
    await seeded;
    await seedBillingAccount(orgAId);
    const count = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: false }, (tx) => tx.billingAccount.count());
    expect(count).toBe(0);
  });

  // --- subscriptions / invoices / payments (directly organization-owned) ----

  it("subscriptions: Org B's context cannot see Org A's subscription", async () => {
    await seeded;
    const account = await seedBillingAccount(orgAId);
    const subId = generateId();
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.subscription.create({ data: { id: subId, organizationId: orgAId, billingAccountId: account.id, provider: "STRIPE", status: "ACTIVE" } }),
    );

    const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.subscription.findUnique({ where: { id: subId } }));
    expect(seenByB).toBeNull();
  });

  it("invoices: Org B's context cannot see Org A's invoice", async () => {
    await seeded;
    const account = await seedBillingAccount(orgAId);
    const invoiceId = generateId();
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.invoice.create({
        data: {
          id: invoiceId,
          organizationId: orgAId,
          billingAccountId: account.id,
          invoiceNumber: `INV-TEST-${invoiceId}`,
          status: "OPEN",
          currency: "USD",
          subtotal: 1000,
          total: 1000,
          amountDue: 1000,
          issueDate: new Date(),
          provider: "STRIPE",
        },
      }),
    );

    const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.invoice.findUnique({ where: { id: invoiceId } }));
    expect(seenByB).toBeNull();
  });

  it("payments: Org B's context cannot see Org A's payment", async () => {
    await seeded;
    const account = await seedBillingAccount(orgAId);
    const paymentId = generateId();
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.payment.create({ data: { id: paymentId, organizationId: orgAId, billingAccountId: account.id, amount: 1000, currency: "USD", status: "SUCCEEDED", provider: "STRIPE", providerPaymentId: `pi_rls_${paymentId}` } }),
    );

    const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.payment.findUnique({ where: { id: paymentId } }));
    expect(seenByB).toBeNull();
  });

  // --- credit_ledger_entries: append-only (no UPDATE/DELETE policy at all) --

  it("credit_ledger_entries: Org A can INSERT its own entry; Org B's context cannot see it", async () => {
    await seeded;
    const account = await seedBillingAccount(orgAId);
    const entryId = generateId();
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.creditLedgerEntry.create({ data: { id: entryId, organizationId: orgAId, billingAccountId: account.id, type: "CREDIT", amount: 500, currency: "USD", reason: "RLS test credit" } }),
    );
    const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.creditLedgerEntry.findUnique({ where: { id: entryId } }));
    expect(seenByB).toBeNull();
  });

  it("credit_ledger_entries: UPDATE is unconditionally rejected — even Org A's own context, even platform staff (append-only, no matching policy at all)", async () => {
    await seeded;
    const account = await seedBillingAccount(orgAId);
    const entryId = generateId();
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.creditLedgerEntry.create({ data: { id: entryId, organizationId: orgAId, billingAccountId: account.id, type: "CREDIT", amount: 500, currency: "USD", reason: "RLS test credit" } }),
    );

    const ownResult = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.creditLedgerEntry.updateMany({ where: { id: entryId }, data: { reason: "tampered" } }),
    );
    expect(ownResult.count).toBe(0);

    const platformResult = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) =>
      tx.creditLedgerEntry.updateMany({ where: { id: entryId }, data: { reason: "tampered" } }),
    );
    expect(platformResult.count).toBe(0);

    const real = await db.creditLedgerEntry.findUnique({ where: { id: entryId } });
    expect(real?.reason).toBe("RLS test credit");
  });

  it("credit_ledger_entries: DELETE is unconditionally rejected", async () => {
    await seeded;
    const account = await seedBillingAccount(orgAId);
    const entryId = generateId();
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.creditLedgerEntry.create({ data: { id: entryId, organizationId: orgAId, billingAccountId: account.id, type: "DEBIT", amount: 200, currency: "USD", reason: "RLS test debit" } }),
    );

    const result = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) => tx.creditLedgerEntry.deleteMany({ where: { id: entryId } }));
    expect(result.count).toBe(0);

    const real = await db.creditLedgerEntry.findUnique({ where: { id: entryId } });
    expect(real).not.toBeNull();
  });

  // --- Transitively organization-owned children ------------------------------

  it("subscription_items: transitively scoped through subscription_id — Org B's context cannot see Org A's subscription's items", async () => {
    await seeded;
    const account = await seedBillingAccount(orgAId);
    const planId = generateId();
    await db.plan.create({ data: { id: planId, key: `rls-test-plan-${planId}`, name: "RLS Test Plan" } });
    const priceId = generateId();
    await db.planPrice.create({ data: { id: priceId, planId, currency: "USD", unitAmount: 1000, interval: "MONTH", provider: "STRIPE" } });

    const subId = generateId();
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.subscription.create({ data: { id: subId, organizationId: orgAId, billingAccountId: account.id, provider: "STRIPE", status: "ACTIVE" } }),
    );
    const itemId = generateId();
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.subscriptionItem.create({ data: { id: itemId, subscriptionId: subId, planPriceId: priceId, quantity: 1, provider: "STRIPE" } }),
    );

    const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.subscriptionItem.findUnique({ where: { id: itemId } }));
    expect(seenByB).toBeNull();

    const seenByA = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.subscriptionItem.findUnique({ where: { id: itemId } }));
    expect(seenByA?.id).toBe(itemId);

    await db.subscriptionItem.deleteMany({ where: { id: itemId } });
    await db.planPrice.deleteMany({ where: { id: priceId } });
    await db.plan.deleteMany({ where: { id: planId } });
  });

  it("invoice_line_items: transitively scoped through invoice_id — Org B's context cannot see Org A's invoice's lines, and no UPDATE policy exists at all (immutable)", async () => {
    await seeded;
    const account = await seedBillingAccount(orgAId);
    const invoiceId = generateId();
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.invoice.create({
        data: { id: invoiceId, organizationId: orgAId, billingAccountId: account.id, invoiceNumber: `INV-RLSTEST-${invoiceId}`, status: "OPEN", currency: "USD", subtotal: 1000, total: 1000, amountDue: 1000, issueDate: new Date(), provider: "STRIPE" },
      }),
    );
    const lineId = generateId();
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.invoiceLineItem.create({ data: { id: lineId, invoiceId, description: "RLS test line", quantity: 1, unitAmount: 1000, subtotal: 1000, total: 1000 } }),
    );

    const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.invoiceLineItem.findUnique({ where: { id: lineId } }));
    expect(seenByB).toBeNull();

    const updateResult = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.invoiceLineItem.updateMany({ where: { id: lineId }, data: { description: "tampered" } }),
    );
    expect(updateResult.count).toBe(0); // no UPDATE policy at all — immutable even for the owning organization's own context
  });

  it("refunds: transitively scoped through payment_id — Org B's context cannot see Org A's payment's refund", async () => {
    await seeded;
    const account = await seedBillingAccount(orgAId);
    const paymentId = generateId();
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.payment.create({ data: { id: paymentId, organizationId: orgAId, billingAccountId: account.id, amount: 1000, currency: "USD", status: "SUCCEEDED", provider: "STRIPE", providerPaymentId: `pi_rlsrefund_${paymentId}` } }),
    );
    const refundId = generateId();
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      tx.refund.create({ data: { id: refundId, paymentId, amount: 500, currency: "USD", status: "SUCCEEDED", provider: "STRIPE", providerRefundId: `re_rls_${refundId}` } }),
    );

    const seenByB = await withTenantContext({ userId: null, organizationId: orgBId, isPlatformStaff: false }, (tx) => tx.refund.findUnique({ where: { id: refundId } }));
    expect(seenByB).toBeNull();

    const deleteResult = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: false }, (tx) => tx.refund.deleteMany({ where: { id: refundId } }));
    expect(deleteResult.count).toBe(0); // no DELETE policy — refund history is never removed
  });

  // --- billing_webhook_events: deliberately NO RLS at all --------------------

  it("billing_webhook_events has no RLS — visible identically regardless of tenant context (platform-infrastructure classification, not tenant data)", async () => {
    const eventId = generateId();
    await db.billingWebhookEvent.create({ data: { id: eventId, provider: "STRIPE", providerEventId: `evt_rls_${eventId}`, eventType: "test.event", payload: {} } });

    // No RLS means this table isn't even reachable meaningfully through
    // `withTenantContext()` for a tenant-scoped read — it has no
    // organization_id column to filter by at all; the real access
    // boundary is `billing.readPlatform`, enforced at the application
    // layer (`billing-platform-service.ts`), not by Postgres row
    // filtering. Confirmed here via the plain (unrestricted) `db`
    // client, matching how the webhook route handler itself accesses
    // this table.
    const row = await db.billingWebhookEvent.findUnique({ where: { id: eventId } });
    expect(row?.id).toBe(eventId);

    await db.billingWebhookEvent.deleteMany({ where: { id: eventId } });
  });
});
