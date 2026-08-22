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
 * Module 14 spec §10/§17/§41 (adversarial #17: "Concurrent refund") —
 * proves `paymentRepository.findByIdLocked()` closes the real
 * over-refund race Module 13's own version of `issueRefund()` left
 * open: two simultaneous requests for the SAME payment must never both
 * succeed for the full amount.
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
  issueRefund: vi.fn(),
  previewSubscriptionChange: vi.fn(),
  changeSubscription: vi.fn(),
  getSubscription: vi.fn(),
  extendTrial: vi.fn(),
  retryInvoicePayment: vi.fn(),
};
vi.mock("@/lib/billing/provider/stripe/provider", () => ({ stripeBillingProvider: mockProvider }));

describe.skipIf(!isDatabaseConfigured)("refund concurrency (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let platformOrgId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    vi.clearAllMocks();
    // Each call gets its OWN provider refund id — a real Stripe refund
    // call would too; a fixed id here would trip the
    // `@@unique([provider, providerRefundId])` constraint and mask the
    // real race this test is proving (same lesson `refund-service.test.ts`
    // already learned in Module 13 — see that file's own comment).
    mockProvider.issueRefund.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30)); // widen the race window deterministically
      return { providerRefundId: `re_concurrency_${generateId()}`, status: "succeeded" };
    });

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Refund Concurrency Org A", displayName: "Refund Concurrency Org A", slug: `refund-concurrency-org-a-${orgAId}` });
    orgIds.push(orgAId);

    const platformOrg = await organizationRepository.findPlatformOrganization();
    platformOrgId = platformOrg!.id;

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));
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

  it("two SIMULTANEOUS full-refund requests on the SAME payment: exactly one succeeds — never an over-refund", async () => {
    const account = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_refund_concurrency_${generateId()}` }, tx),
    );
    const payment = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      paymentRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: account.id, amount: 10_000, currency: "USD", status: "SUCCEEDED", provider: "STRIPE", providerPaymentId: `pi_refund_concurrency_${generateId()}` }, tx),
    );

    const owner = await makeMember(platformOrgId, "platform_owner", "refund-concurrency-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { issueRefund } = await import("@/server/services/refund-service");

    const results = await Promise.allSettled([
      issueRefund({ organizationId: orgAId, paymentId: payment.id }),
      issueRefund({ organizationId: orgAId, paymentId: payment.id }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "VALIDATION_ERROR" });

    // The real invariant: total refunded NEVER exceeds the payment
    // amount, verified directly against the database, not just against
    // the two promises' own outcomes.
    const refunds = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => refundRepository.listForPayment(payment.id, tx));
    const totalRefunded = refunds.reduce((sum, r) => sum + r.amount, 0);
    expect(totalRefunded).toBe(10_000);
    expect(refunds).toHaveLength(1); // not two rows for the same amount

    expect(mockProvider.issueRefund).toHaveBeenCalledTimes(1); // the loser never reached the provider at all

    const finalPayment = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => paymentRepository.findById(payment.id, tx));
    expect(finalPayment?.status).toBe("REFUNDED");
  });

  it("two SIMULTANEOUS partial-refund requests that would TOGETHER exceed the payment amount: only the combination that fits succeeds", async () => {
    const account = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_refund_partial_${generateId()}` }, tx),
    );
    const payment = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      paymentRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: account.id, amount: 10_000, currency: "USD", status: "SUCCEEDED", provider: "STRIPE", providerPaymentId: `pi_refund_partial_${generateId()}` }, tx),
    );

    const owner = await makeMember(platformOrgId, "platform_owner", "refund-partial-concurrency-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { issueRefund } = await import("@/server/services/refund-service");

    // 6,000 + 6,000 = 12,000 > 10,000 — together they would over-refund
    // if both were allowed through.
    const results = await Promise.allSettled([
      issueRefund({ organizationId: orgAId, paymentId: payment.id, amount: 6_000 }),
      issueRefund({ organizationId: orgAId, paymentId: payment.id, amount: 6_000 }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1); // the second 6,000 request correctly sees only 4,000 remaining and is rejected

    const refunds = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => refundRepository.listForPayment(payment.id, tx));
    const totalRefunded = refunds.reduce((sum, r) => sum + r.amount, 0);
    expect(totalRefunded).toBeLessThanOrEqual(10_000);
    expect(totalRefunded).toBe(6_000);
  });

  it("two refunds on DIFFERENT payments proceed independently, in parallel — the lock is per-payment, not global", async () => {
    const account = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_refund_independent_${generateId()}` }, tx),
    );
    const [paymentA, paymentB] = await Promise.all([
      withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
        paymentRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: account.id, amount: 5_000, currency: "USD", status: "SUCCEEDED", provider: "STRIPE", providerPaymentId: `pi_independent_a_${generateId()}` }, tx),
      ),
      withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
        paymentRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: account.id, amount: 5_000, currency: "USD", status: "SUCCEEDED", provider: "STRIPE", providerPaymentId: `pi_independent_b_${generateId()}` }, tx),
      ),
    ]);

    const owner = await makeMember(platformOrgId, "platform_owner", "refund-independent-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { issueRefund } = await import("@/server/services/refund-service");

    const results = await Promise.allSettled([
      issueRefund({ organizationId: orgAId, paymentId: paymentA.id }),
      issueRefund({ organizationId: orgAId, paymentId: paymentB.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
  });
});
