import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { paymentRepository, refundRepository } from "@/server/repositories/payment-repository";
import { withTenantContext } from "@/lib/tenancy/context";

/**
 * `refund-service.ts` (Module 13) — the module's single most
 * financially sensitive mutation. Spec §55 Q8 ("Can a support user
 * issue an unauthorized refund?") and Q22 ("Can refund amounts exceed
 * the original payment?") are both proven here with real, automated
 * regression tests, not just reasoned about in docs.
 */

let mockUser: { id: string } | null = null;
let mockMembershipsByOrg = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (organizationId) return mockMembershipsByOrg.get(organizationId) ?? null;
    return mockMembershipsByOrg.size === 1 ? [...mockMembershipsByOrg.values()][0] : null;
  }),
}));

const mockProvider = {
  createCustomer: vi.fn(),
  createCheckoutSession: vi.fn(),
  createBillingPortalSession: vi.fn(),
  cancelSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
  issueRefund: vi.fn(async () => ({ providerRefundId: `re_test_${generateId()}`, status: "succeeded" })),
};
vi.mock("@/lib/billing/provider/stripe/provider", () => ({ stripeBillingProvider: mockProvider }));

describe.skipIf(!isDatabaseConfigured)("refund-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let platformOrgId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};
  let accountA: Awaited<ReturnType<typeof billingAccountRepository.create>>;

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    vi.clearAllMocks();
    // `mockImplementation`, not `mockResolvedValue` — a fixed resolved
    // value would return the SAME `providerRefundId` on every call
    // within a test, which the real `@@unique([provider,
    // providerRefundId])` constraint (correctly) rejects on a second
    // refund. Each real Stripe refund call gets its own id; the mock
    // must too.
    mockProvider.issueRefund.mockImplementation(async () => ({ providerRefundId: `re_test_${generateId()}`, status: "succeeded" }));

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Refund Test Org A", displayName: "Refund Test Org A", slug: `refund-org-a-${orgAId}` });
    orgIds.push(orgAId);

    const platformOrg = await organizationRepository.findPlatformOrganization();
    platformOrgId = platformOrg!.id;

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));

    accountA = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_refund_test_${generateId()}` }, tx),
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

  async function seedPayment(amount = 10_000) {
    return withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      paymentRepository.create(
        { id: generateId(), organizationId: orgAId, billingAccountId: accountA.id, amount, currency: "USD", status: "SUCCEEDED", provider: "STRIPE", providerPaymentId: `pi_refund_test_${generateId()}` },
        tx,
      ),
    );
  }

  it("platform_owner (billing.refund) can issue a full refund; the Payment's status becomes REFUNDED", async () => {
    const payment = await seedPayment(10_000);
    const owner = await makeMember(platformOrgId, "platform_owner", "refund-owner@example.com");
    actAs(owner.userId, owner.membership);

    const { issueRefund } = await import("@/server/services/refund-service");
    const refund = await issueRefund({ organizationId: orgAId, paymentId: payment.id });
    expect(refund.amount).toBe(10_000);
    expect(refund.status).toBe("SUCCEEDED");

    const updatedPayment = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => paymentRepository.findById(payment.id, tx));
    expect(updatedPayment?.status).toBe("REFUNDED");
  });

  it("platform_admin CANNOT issue a refund — owner-only (spec §55 Q8, adjacent role)", async () => {
    const payment = await seedPayment();
    const admin = await makeMember(platformOrgId, "platform_admin", "refund-admin@example.com");
    actAs(admin.userId, admin.membership);

    const { issueRefund } = await import("@/server/services/refund-service");
    await expect(issueRefund({ organizationId: orgAId, paymentId: payment.id })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    expect(mockProvider.issueRefund).not.toHaveBeenCalled();
  });

  it("support_admin (billing.readPlatform only) CANNOT issue a refund — spec §55 Q8, the literal question", async () => {
    const payment = await seedPayment();
    const support = await makeMember(platformOrgId, "support_admin", "refund-support@example.com");
    actAs(support.userId, support.membership);

    const { issueRefund } = await import("@/server/services/refund-service");
    await expect(issueRefund({ organizationId: orgAId, paymentId: payment.id })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    expect(mockProvider.issueRefund).not.toHaveBeenCalled();
  });

  it("an organization's own owner CANNOT issue a refund on their own payment — refunds are platform-staff-only, never self-service", async () => {
    const payment = await seedPayment();
    const orgOwner = await makeMember(orgAId, "owner", "refund-org-owner@example.com");
    actAs(orgOwner.userId, orgOwner.membership);

    const { issueRefund } = await import("@/server/services/refund-service");
    await expect(issueRefund({ organizationId: orgAId, paymentId: payment.id })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("a refund amount exceeding the payment's remaining refundable balance is rejected (spec §55 Q22)", async () => {
    const payment = await seedPayment(10_000);
    const owner = await makeMember(platformOrgId, "platform_owner", "refund-overamount-owner@example.com");
    actAs(owner.userId, owner.membership);

    const { issueRefund } = await import("@/server/services/refund-service");
    await expect(issueRefund({ organizationId: orgAId, paymentId: payment.id, amount: 10_001 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockProvider.issueRefund).not.toHaveBeenCalled();
  });

  it("a second refund cannot push the cumulative total past the original payment amount", async () => {
    const payment = await seedPayment(10_000);
    const owner = await makeMember(platformOrgId, "platform_owner", "refund-cumulative-owner@example.com");
    actAs(owner.userId, owner.membership);

    const { issueRefund } = await import("@/server/services/refund-service");
    const first = await issueRefund({ organizationId: orgAId, paymentId: payment.id, amount: 6_000 });
    expect(first.amount).toBe(6_000);

    // Only 4,000 remains refundable — 5,000 must be rejected.
    await expect(issueRefund({ organizationId: orgAId, paymentId: payment.id, amount: 5_000 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // Exactly 4,000 (the true remainder) succeeds.
    const second = await issueRefund({ organizationId: orgAId, paymentId: payment.id, amount: 4_000 });
    expect(second.amount).toBe(4_000);

    const refunds = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => refundRepository.listForPayment(payment.id, tx));
    expect(refunds.reduce((sum, r) => sum + r.amount, 0)).toBe(10_000);

    const finalPayment = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => paymentRepository.findById(payment.id, tx));
    expect(finalPayment?.status).toBe("REFUNDED");
  });

  it("a forged paymentId belonging to another organization is rejected", async () => {
    const orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "Refund Org B", displayName: "Refund Org B", slug: `refund-org-b-${orgBId}` });
    orgIds.push(orgBId);
    const payment = await seedPayment();

    const owner = await makeMember(platformOrgId, "platform_owner", "refund-forged-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { issueRefund } = await import("@/server/services/refund-service");
    // paymentId is real, but claimed under the WRONG organizationId.
    await expect(issueRefund({ organizationId: orgBId, paymentId: payment.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refunding a payment that hasn't succeeded is rejected", async () => {
    const payment = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      paymentRepository.create(
        { id: generateId(), organizationId: orgAId, billingAccountId: accountA.id, amount: 5_000, currency: "USD", status: "FAILED", provider: "STRIPE", providerPaymentId: `pi_failed_test_${generateId()}` },
        tx,
      ),
    );
    const owner = await makeMember(platformOrgId, "platform_owner", "refund-failed-owner@example.com");
    actAs(owner.userId, owner.membership);

    const { issueRefund } = await import("@/server/services/refund-service");
    await expect(issueRefund({ organizationId: orgAId, paymentId: payment.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
