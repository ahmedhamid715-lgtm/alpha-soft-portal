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
import { paymentRepository, refundRepository } from "@/server/repositories/payment-repository";
import { creditLedgerRepository } from "@/server/repositories/credit-ledger-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { nextInvoiceNumber } from "@/lib/billing/invoice-numbering";

const PLATFORM_TEST_CURRENCY = "GBP";

let mockUser: { id: string } | null = null;
let mockMembershipsByOrg = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (organizationId) return mockMembershipsByOrg.get(organizationId) ?? null;
    return mockMembershipsByOrg.size === 1 ? [...mockMembershipsByOrg.values()][0] : null;
  }),
}));

describe.skipIf(!isDatabaseConfigured)("revenue-reporting-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let platformOrgId: string;
  let accountA: Awaited<ReturnType<typeof billingAccountRepository.create>>;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Revenue Test Org A", displayName: "Revenue Test Org A", slug: `revenue-org-a-${orgAId}` });
    orgIds.push(orgAId);

    const platformOrg = await organizationRepository.findPlatformOrganization();
    platformOrgId = platformOrg!.id;
    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));

    accountA = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_revenue_test_${generateId()}` }, tx),
    );
  });

  afterEach(async () => {
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
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

  async function seedInvoice(organizationId: string, billingAccountId: string, overrides: { status?: "DRAFT" | "OPEN" | "PAID"; total?: number; amountDue?: number; amountPaid?: number; dueDate?: Date | null; currency?: string } = {}) {
    const invoiceNumber = await nextInvoiceNumber();
    const total = overrides.total ?? 10000;
    return withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
      invoiceRepository.create(
        {
          id: generateId(),
          organizationId,
          billingAccountId,
          invoiceNumber,
          status: overrides.status ?? "PAID",
          currency: overrides.currency ?? "USD",
          subtotal: total,
          discountTotal: 0,
          taxTotal: 0,
          total,
          amountPaid: overrides.amountPaid ?? total,
          amountDue: overrides.amountDue ?? 0,
          issueDate: new Date(),
          dueDate: overrides.dueDate,
          provider: "STRIPE",
        },
        tx,
      ),
    );
  }

  it("getOrganizationRevenueReport: sums billed for a non-DRAFT invoice issued today", async () => {
    await seedInvoice(orgAId, accountA.id, { status: "PAID", total: 15000 });
    const owner = await makeMember(orgAId, "owner", "revenue-billed-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getOrganizationRevenueReport } = await import("@/server/services/revenue-reporting-service");
    const result = await getOrganizationRevenueReport({ organizationId: orgAId, period: "today" });
    expect(result.billed).toEqual([{ currency: "USD", subtotal: 15000, total: 15000, invoiceCount: 1 }]);
  });

  it("getOrganizationRevenueReport: a DRAFT invoice is excluded from billed", async () => {
    await seedInvoice(orgAId, accountA.id, { status: "DRAFT", total: 9999 });
    const owner = await makeMember(orgAId, "owner", "revenue-draft-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getOrganizationRevenueReport } = await import("@/server/services/revenue-reporting-service");
    const result = await getOrganizationRevenueReport({ organizationId: orgAId, period: "today" });
    expect(result.billed).toEqual([]);
  });

  it("getOrganizationRevenueReport: sums collected (SUCCEEDED payments paid today), refunded, and credits issued", async () => {
    const payment = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      paymentRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: accountA.id, amount: 8000, currency: "USD", status: "SUCCEEDED", provider: "STRIPE", providerPaymentId: `pi_revenue_test_${generateId()}`, paidAt: new Date() }, tx),
    );
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      refundRepository.create({ id: generateId(), paymentId: payment.id, amount: 3000, currency: "USD", status: "SUCCEEDED", provider: "STRIPE", providerRefundId: `re_revenue_test_${generateId()}` }, tx),
    );
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      creditLedgerRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: accountA.id, type: "CREDIT", amount: 1200, currency: "USD", reason: "test credit" }, tx),
    );

    const owner = await makeMember(orgAId, "owner", "revenue-collected-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getOrganizationRevenueReport } = await import("@/server/services/revenue-reporting-service");
    const result = await getOrganizationRevenueReport({ organizationId: orgAId, period: "today" });
    expect(result.collected).toEqual([{ currency: "USD", amount: 8000, paymentCount: 1 }]);
    expect(result.refunded).toEqual([{ currency: "USD", amount: 3000, refundCount: 1 }]);
    expect(result.creditsIssued).toEqual([{ currency: "USD", amount: 1200, entryCount: 1 }]);
    expect(result.netCollected).toEqual([{ currency: "USD", amount: 5000 }]); // 8000 collected - 3000 refunded
  });

  it("getOrganizationRevenueReport: a member without billing.read is denied", async () => {
    const member = await makeMember(orgAId, "member", "revenue-denied-member@example.com");
    actAs(member.userId, member.membership);
    const { getOrganizationRevenueReport } = await import("@/server/services/revenue-reporting-service");
    await expect(getOrganizationRevenueReport({ organizationId: orgAId, period: "today" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("getPlatformRevenueReport: requires billing.analytics.read", async () => {
    const owner = await makeMember(orgAId, "owner", "revenue-platform-denied-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getPlatformRevenueReport } = await import("@/server/services/revenue-reporting-service");
    await expect(getPlatformRevenueReport({ period: "today" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("getPlatformRevenueReport: isolated reserved-currency billed total is visible platform-wide", async () => {
    await seedInvoice(orgAId, accountA.id, { status: "OPEN", total: 4200, currency: PLATFORM_TEST_CURRENCY });
    const admin = await makeMember(platformOrgId, "platform_admin", "revenue-platform-admin@example.com");
    actAs(admin.userId, admin.membership);
    const { getPlatformRevenueReport } = await import("@/server/services/revenue-reporting-service");
    const result = await getPlatformRevenueReport({ period: "today" });
    expect(result.billed.find((r) => r.currency === PLATFORM_TEST_CURRENCY)).toEqual({ currency: PLATFORM_TEST_CURRENCY, subtotal: 4200, total: 4200, invoiceCount: 1 });
  });

  it("getOrganizationAgingReport: an OPEN invoice past its due date lands in the correct bucket", async () => {
    const daysAgo10 = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await seedInvoice(orgAId, accountA.id, { status: "OPEN", total: 5000, amountDue: 5000, amountPaid: 0, dueDate: daysAgo10 });
    const owner = await makeMember(orgAId, "owner", "revenue-aging-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getOrganizationAgingReport } = await import("@/server/services/revenue-reporting-service");
    const result = await getOrganizationAgingReport({ organizationId: orgAId });
    expect(result.buckets).toEqual([{ bucket: "1_30", currency: "USD", amount: 5000, invoiceCount: 1 }]);
  });

  it("getOrganizationAgingReport: a PAID invoice never appears in the aging report", async () => {
    await seedInvoice(orgAId, accountA.id, { status: "PAID", total: 5000, dueDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) });
    const owner = await makeMember(orgAId, "owner", "revenue-aging-paid-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getOrganizationAgingReport } = await import("@/server/services/revenue-reporting-service");
    const result = await getOrganizationAgingReport({ organizationId: orgAId });
    expect(result.buckets).toEqual([]);
  });

  it("getPlatformAgingReport: requires billing.analytics.read", async () => {
    const owner = await makeMember(orgAId, "owner", "revenue-aging-platform-denied@example.com");
    actAs(owner.userId, owner.membership);
    const { getPlatformAgingReport } = await import("@/server/services/revenue-reporting-service");
    await expect(getPlatformAgingReport()).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("Org B's owner cannot read Org A's revenue report via a forged organizationId", async () => {
    await seedInvoice(orgAId, accountA.id, { status: "PAID", total: 5000 });
    const orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "Revenue Test Org B", displayName: "Revenue Test Org B", slug: `revenue-org-b-${orgBId}` });
    orgIds.push(orgBId);
    const ownerB = await makeMember(orgBId, "owner", "revenue-cross-tenant-owner@example.com");
    actAs(ownerB.userId, ownerB.membership);
    const { getOrganizationRevenueReport } = await import("@/server/services/revenue-reporting-service");
    await expect(getOrganizationRevenueReport({ organizationId: orgAId, period: "today" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });
});
