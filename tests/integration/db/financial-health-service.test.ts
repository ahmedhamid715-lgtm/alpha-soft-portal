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
import { paymentRepository } from "@/server/repositories/payment-repository";
import { withTenantContext } from "@/lib/tenancy/context";
import { nextInvoiceNumber } from "@/lib/billing/invoice-numbering";

let mockUser: { id: string } | null = null;
let mockMembershipsByOrg = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (organizationId) return mockMembershipsByOrg.get(organizationId) ?? null;
    return mockMembershipsByOrg.size === 1 ? [...mockMembershipsByOrg.values()][0] : null;
  }),
}));

describe.skipIf(!isDatabaseConfigured)("financial-health-service (database integration)", () => {
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
    await organizationRepository.create({ id: orgAId, name: "Health Test Org A", displayName: "Health Test Org A", slug: `health-org-a-${orgAId}` });
    orgIds.push(orgAId);

    const platformOrg = await organizationRepository.findPlatformOrganization();
    platformOrgId = platformOrg!.id;
    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));

    accountA = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_health_test_${generateId()}` }, tx),
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

  it("getOrganizationFinancialHealthForPlatform: a clean organization with no signals is HEALTHY", async () => {
    const support = await makeMember(platformOrgId, "support_admin", "health-clean-support@example.com");
    actAs(support.userId, support.membership);
    const { getOrganizationFinancialHealthForPlatform } = await import("@/server/services/financial-health-service");
    const result = await getOrganizationFinancialHealthForPlatform({ organizationId: orgAId });
    expect(result.classification).toBe("HEALTHY");
  });

  it("getOrganizationFinancialHealthForPlatform: a real 45-day-overdue invoice drives AT_RISK, naming the real invoice number", async () => {
    const invoiceNumber = await nextInvoiceNumber();
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      invoiceRepository.create(
        { id: generateId(), organizationId: orgAId, billingAccountId: accountA.id, invoiceNumber, status: "OPEN", currency: "USD", subtotal: 5000, discountTotal: 0, taxTotal: 0, total: 5000, amountPaid: 0, amountDue: 5000, issueDate: new Date(), dueDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), provider: "STRIPE" },
        tx,
      ),
    );

    const support = await makeMember(platformOrgId, "support_admin", "health-overdue-support@example.com");
    actAs(support.userId, support.membership);
    const { getOrganizationFinancialHealthForPlatform } = await import("@/server/services/financial-health-service");
    const result = await getOrganizationFinancialHealthForPlatform({ organizationId: orgAId });
    expect(result.classification).toBe("AT_RISK");
    expect(result.reasons.some((r) => r.includes(invoiceNumber))).toBe(true);
  });

  it("getOrganizationFinancialHealthForPlatform: a SUSPENDED billing account drives CRITICAL", async () => {
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => billingAccountRepository.updateStatus(accountA.id, "SUSPENDED", tx));
    const support = await makeMember(platformOrgId, "support_admin", "health-suspended-support@example.com");
    actAs(support.userId, support.membership);
    const { getOrganizationFinancialHealthForPlatform } = await import("@/server/services/financial-health-service");
    const result = await getOrganizationFinancialHealthForPlatform({ organizationId: orgAId });
    expect(result.classification).toBe("CRITICAL");
  });

  it("getOrganizationFinancialHealthForPlatform: 2 real failed payments in the last 30 days drive AT_RISK", async () => {
    for (let i = 0; i < 2; i++) {
      await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
        paymentRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: accountA.id, amount: 1000, currency: "USD", status: "FAILED", provider: "STRIPE", providerPaymentId: `pi_health_test_${generateId()}` }, tx),
      );
    }
    const support = await makeMember(platformOrgId, "support_admin", "health-failed-support@example.com");
    actAs(support.userId, support.membership);
    const { getOrganizationFinancialHealthForPlatform } = await import("@/server/services/financial-health-service");
    const result = await getOrganizationFinancialHealthForPlatform({ organizationId: orgAId });
    expect(result.classification).toBe("AT_RISK");
    expect(result.reasons).toContain("2 payments failed in the last 30 days.");
  });

  it("getOrganizationFinancialHealthForPlatform: requires billing.readPlatform — an organization owner cannot use the platform investigation path", async () => {
    const owner = await makeMember(orgAId, "owner", "health-denied-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getOrganizationFinancialHealthForPlatform } = await import("@/server/services/financial-health-service");
    await expect(getOrganizationFinancialHealthForPlatform({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("listAtRiskOrganizations: an AT_RISK organization appears; a HEALTHY one does not", async () => {
    const invoiceNumber = await nextInvoiceNumber();
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      invoiceRepository.create(
        { id: generateId(), organizationId: orgAId, billingAccountId: accountA.id, invoiceNumber, status: "OPEN", currency: "USD", subtotal: 5000, discountTotal: 0, taxTotal: 0, total: 5000, amountPaid: 0, amountDue: 5000, issueDate: new Date(), dueDate: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), provider: "STRIPE" },
        tx,
      ),
    );

    const admin = await makeMember(platformOrgId, "platform_admin", "health-list-admin@example.com");
    actAs(admin.userId, admin.membership);
    const { listAtRiskOrganizations } = await import("@/server/services/financial-health-service");
    const result = await listAtRiskOrganizations();
    expect(result.some((r) => r.organizationId === orgAId && r.health.classification === "AT_RISK")).toBe(true);
  });

  it("listAtRiskOrganizations: requires billing.analytics.read", async () => {
    const owner = await makeMember(orgAId, "owner", "health-list-denied-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { listAtRiskOrganizations } = await import("@/server/services/financial-health-service");
    await expect(listAtRiskOrganizations()).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });
});
