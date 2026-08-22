import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { invoiceRepository } from "@/server/repositories/invoice-repository";
import { nextInvoiceNumber } from "@/lib/billing/invoice-numbering";
import { withTenantContext } from "@/lib/tenancy/context";

let mockUser: { id: string } | null = null;
let mockMembershipsByOrg = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (organizationId) return mockMembershipsByOrg.get(organizationId) ?? null;
    return mockMembershipsByOrg.size === 1 ? [...mockMembershipsByOrg.values()][0] : null;
  }),
}));

/**
 * `billing-diagnostics-service.ts` (Module 15) — this is a genuinely
 * financially-healthy dev database (every mutation path enforces the
 * invariants these checks re-verify), so the honest, correctly-passing
 * assertion for the CONSISTENCY checks is "found zero anomalies of this
 * class" — proving the diagnostic runs cleanly against real data, not a
 * synthetic failure. The webhook-staleness check IS exercised with a
 * real anomaly (a directly-inserted stale PENDING row — bypassing the
 * normal write path on purpose, the only way to produce this specific
 * abnormal state at all).
 */
describe.skipIf(!isDatabaseConfigured)("billing-diagnostics-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  const webhookEventIds: string[] = [];
  let orgAId: string;
  let platformOrgId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Diagnostics Test Org A", displayName: "Diagnostics Test Org A", slug: `diagnostics-org-a-${orgAId}` });
    orgIds.push(orgAId);
    const platformOrg = await organizationRepository.findPlatformOrganization();
    platformOrgId = platformOrg!.id;
    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));
  });

  afterEach(async () => {
    if (webhookEventIds.length) await db.billingWebhookEvent.deleteMany({ where: { id: { in: webhookEventIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    webhookEventIds.length = 0;
    userIds.length = 0;
    orgIds.length = 0;
    vi.restoreAllMocks();
  });

  async function makeMember(organizationId: string, roleKey: string, email: string) {
    const userId = generateId();
    await userRepository.create({ id: userId, email, name: email });
    userIds.push(userId);
    const role = roleByKey[roleKey];
    const membership = await membershipRepository.create({ id: generateId(), organizationId, userId, role: roleKey });
    await membershipRepository.updateRoleAssignment(membership.id, { role: roleKey, roleId: role.id });
    return { userId, membership: { ...membership, roleId: role.id } };
  }

  function actAs(userId: string, membership: { organizationId: string; userId: string; roleId: string | null; status: string }) {
    mockUser = { id: userId };
    mockMembershipsByOrg = new Map([[membership.organizationId, membership]]);
  }

  it("getControlCenterReport: requires billing.controls.read — an organization owner is denied", async () => {
    const owner = await makeMember(orgAId, "owner", "diagnostics-denied-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getControlCenterReport } = await import("@/server/services/billing-diagnostics-service");
    await expect(getControlCenterReport()).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("getControlCenterReport: support_admin (billing.controls.read) can run it; reports a coherent, well-shaped result", async () => {
    const support = await makeMember(platformOrgId, "support_admin", "diagnostics-support@example.com");
    actAs(support.userId, support.membership);
    const { getControlCenterReport } = await import("@/server/services/billing-diagnostics-service");
    const result = await getControlCenterReport();
    expect(result.webhookHealth.countsByStatus).toHaveProperty("PENDING");
    expect(result.webhookHealth.countsByStatus).toHaveProperty("PROCESSED");
    expect(typeof result.providerConnectivity.configured).toBe("boolean");
    expect(result.totalAnomalyCount).toBe(
      result.webhookHealth.staleAnomalies.length +
        result.consistency.invoiceBalanceAnomalies.length +
        result.consistency.refundAnomalies.length +
        result.consistency.creditBalanceAnomalies.length +
        result.consistency.creditRelationAnomalies.length +
        result.consistency.subscriptionStateAnomalies.length +
        result.consistency.duplicatePaymentAnomalies.length +
        result.consistency.taxComponentAnomalies.length,
    );
  });

  it("getControlCenterReport (Module 16): a line item whose rolled-up taxAmount disagrees with its own InvoiceLineItemTax rows is flagged", async () => {
    const account = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_diagnostics_tax_${generateId()}` }, tx),
    );
    const invoiceNumber = await nextInvoiceNumber();
    const invoice = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      invoiceRepository.create(
        { id: generateId(), organizationId: orgAId, billingAccountId: account.id, invoiceNumber, status: "PAID", currency: "USD", subtotal: 10000, discountTotal: 0, taxTotal: 850, total: 10850, amountPaid: 10850, amountDue: 0, issueDate: new Date(), provider: "STRIPE" },
        tx,
      ),
    );
    // taxAmount (850) rolled up, but ZERO InvoiceLineItemTax rows written for it — a real, deliberately-produced mismatch (bypassing the normal webhook write path, the only way to construct this abnormal state, same convention this file's own stale-webhook test already uses).
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      invoiceRepository.addLineItem({ id: generateId(), invoiceId: invoice.id, description: "Mismatched tax line", quantity: 1, unitAmount: 10000, subtotal: 10000, discountAmount: 0, taxAmount: 850, total: 10000 }, tx),
    );

    const owner = await makeMember(platformOrgId, "platform_owner", "diagnostics-tax-mismatch-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getControlCenterReport } = await import("@/server/services/billing-diagnostics-service");
    const result = await getControlCenterReport();
    expect(result.consistency.taxComponentAnomalies.some((a) => a.organizationId === orgAId)).toBe(true);
  });

  it("getControlCenterReport (Module 16): a line item whose rolled-up taxAmount agrees with its own InvoiceLineItemTax rows is NOT flagged", async () => {
    const account = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_diagnostics_tax_ok_${generateId()}` }, tx),
    );
    const invoiceNumber = await nextInvoiceNumber();
    const invoice = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      invoiceRepository.create(
        { id: generateId(), organizationId: orgAId, billingAccountId: account.id, invoiceNumber, status: "PAID", currency: "USD", subtotal: 10000, discountTotal: 0, taxTotal: 850, total: 10850, amountPaid: 10850, amountDue: 0, issueDate: new Date(), provider: "STRIPE" },
        tx,
      ),
    );
    const lineItem = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      invoiceRepository.addLineItem(
        {
          id: generateId(),
          invoiceId: invoice.id,
          description: "Consistent tax line",
          quantity: 1,
          unitAmount: 10000,
          subtotal: 10000,
          discountAmount: 0,
          taxAmount: 850,
          total: 10000,
          taxes: [{ id: generateId(), providerTaxRateId: "txr_test", taxabilityReason: "standard_rated", taxBehavior: "exclusive", amount: 850 }],
        },
        tx,
      ),
    );

    const owner = await makeMember(platformOrgId, "platform_owner", "diagnostics-tax-ok-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getControlCenterReport } = await import("@/server/services/billing-diagnostics-service");
    const result = await getControlCenterReport();
    expect(result.consistency.taxComponentAnomalies.some((a) => a.resourceId === lineItem.id)).toBe(false);
  });

  it("getControlCenterReport: a genuinely stale PENDING webhook event is flagged", async () => {
    const staleId = generateId();
    await db.billingWebhookEvent.create({
      data: {
        id: staleId,
        provider: "STRIPE",
        providerEventId: `evt_stale_test_${generateId()}`,
        eventType: "customer.subscription.updated",
        payload: {},
        status: "PENDING",
        receivedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago — well past the 1-hour staleness threshold
      },
    });
    webhookEventIds.push(staleId);

    const owner = await makeMember(platformOrgId, "platform_owner", "diagnostics-stale-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getControlCenterReport } = await import("@/server/services/billing-diagnostics-service");
    const result = await getControlCenterReport();
    expect(result.webhookHealth.staleAnomalies.some((a) => a.resourceId === staleId)).toBe(true);
  });

  it("getControlCenterReport: a genuinely fresh PENDING webhook event is NOT flagged", async () => {
    const freshId = generateId();
    await db.billingWebhookEvent.create({
      data: { id: freshId, provider: "STRIPE", providerEventId: `evt_fresh_test_${generateId()}`, eventType: "customer.subscription.updated", payload: {}, status: "PENDING", receivedAt: new Date() },
    });
    webhookEventIds.push(freshId);

    const owner = await makeMember(platformOrgId, "platform_owner", "diagnostics-fresh-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getControlCenterReport } = await import("@/server/services/billing-diagnostics-service");
    const result = await getControlCenterReport();
    expect(result.webhookHealth.staleAnomalies.some((a) => a.resourceId === freshId)).toBe(false);
  });
});
