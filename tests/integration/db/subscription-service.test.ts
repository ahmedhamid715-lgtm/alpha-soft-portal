import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { planRepository, planPriceRepository } from "@/server/repositories/plan-repository";
import { withTenantContext } from "@/lib/tenancy/context";

/**
 * `subscription-service.ts` (Module 13) — the checkout/cancel/resume
 * user-action surface. Every server-derived-pricing / forged-input
 * adversarial question from spec §55 (Q4/Q5/Q7) is proven here: the
 * client submits only `planPriceId`; the server independently resolves
 * the real price, provider id, and currency — never a client-supplied
 * amount or provider id.
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
  createCustomer: vi.fn(async () => ({ providerCustomerId: `cus_test_${generateId()}` })),
  createCheckoutSession: vi.fn(async () => ({ url: "https://checkout.stripe.com/test-session" })),
  createBillingPortalSession: vi.fn(),
  cancelSubscription: vi.fn(async () => undefined),
  resumeSubscription: vi.fn(async () => undefined),
  issueRefund: vi.fn(),
};

vi.mock("@/lib/billing/provider/stripe/provider", () => ({ stripeBillingProvider: mockProvider }));

describe.skipIf(!isDatabaseConfigured)("subscription-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  const planIds: string[] = [];
  let orgAId: string;
  let orgBId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};
  let activePlanPriceId: string;
  let inactivePlanPriceId: string;
  let noProviderPlanPriceId: string;

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    vi.clearAllMocks();
    mockProvider.createCustomer.mockResolvedValue({ providerCustomerId: `cus_test_${generateId()}` });
    mockProvider.createCheckoutSession.mockResolvedValue({ url: "https://checkout.stripe.com/test-session" });

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Sub Test Org A", displayName: "Sub Test Org A", slug: `sub-org-a-${orgAId}` });
    orgIds.push(orgAId);
    orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "Sub Test Org B", displayName: "Sub Test Org B", slug: `sub-org-b-${orgBId}` });
    orgIds.push(orgBId);

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));

    const plan = await planRepository.create({ id: generateId(), key: `sub_test_plan_${generateId().replace(/-/g, "_")}`.slice(0, 40), name: "Sub Test Plan" });
    planIds.push(plan.id);
    const activePrice = await planPriceRepository.create({ id: generateId(), planId: plan.id, currency: "USD", unitAmount: 5000, interval: "MONTH", provider: "STRIPE", providerPriceId: `price_test_${generateId()}` });
    activePlanPriceId = activePrice.id;

    const inactivePrice = await planPriceRepository.create({ id: generateId(), planId: plan.id, currency: "USD", unitAmount: 3000, interval: "MONTH", provider: "STRIPE", providerPriceId: `price_test_inactive_${generateId()}` });
    await planPriceRepository.update(inactivePrice.id, { active: false });
    inactivePlanPriceId = inactivePrice.id;

    const noProviderPrice = await planPriceRepository.create({ id: generateId(), planId: plan.id, currency: "USD", unitAmount: 7000, interval: "MONTH", provider: "STRIPE" });
    noProviderPlanPriceId = noProviderPrice.id;
  });

  afterEach(async () => {
    if (planIds.length) await db.plan.deleteMany({ where: { id: { in: planIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    orgIds.length = 0;
    planIds.length = 0;
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

  it("owner can start a checkout for an active plan price — the server resolves the provider price id, never trusting a client-supplied one", async () => {
    const owner = await makeMember(orgAId, "owner", "checkout-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { startCheckoutForPlanPrice } = await import("@/server/services/subscription-service");

    const result = await startCheckoutForPlanPrice({ organizationId: orgAId, planPriceId: activePlanPriceId });
    expect(result.url).toBe("https://checkout.stripe.com/test-session");
    expect(mockProvider.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgAId, providerPriceId: expect.stringMatching(/^price_test_/) }),
    );
  });

  it("admin (holds billing.read but NOT billing.manage) cannot start a checkout — plan changes are owner-only", async () => {
    const admin = await makeMember(orgAId, "admin", "checkout-admin@example.com");
    actAs(admin.userId, admin.membership);
    const { startCheckoutForPlanPrice } = await import("@/server/services/subscription-service");

    await expect(startCheckoutForPlanPrice({ organizationId: orgAId, planPriceId: activePlanPriceId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("a forged/nonexistent planPriceId is rejected (spec §55 Q4)", async () => {
    const owner = await makeMember(orgAId, "owner", "checkout-forged-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { startCheckoutForPlanPrice } = await import("@/server/services/subscription-service");

    await expect(startCheckoutForPlanPrice({ organizationId: orgAId, planPriceId: generateId() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("an inactive (deactivated) plan price is rejected, even with the correct id", async () => {
    const owner = await makeMember(orgAId, "owner", "checkout-inactive-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { startCheckoutForPlanPrice } = await import("@/server/services/subscription-service");

    await expect(startCheckoutForPlanPrice({ organizationId: orgAId, planPriceId: inactivePlanPriceId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a plan price with no providerPriceId (not yet synced to Stripe) is rejected", async () => {
    const owner = await makeMember(orgAId, "owner", "checkout-no-provider-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { startCheckoutForPlanPrice } = await import("@/server/services/subscription-service");

    await expect(startCheckoutForPlanPrice({ organizationId: orgAId, planPriceId: noProviderPlanPriceId })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("Org B's owner cannot start a checkout for Org A (cross-tenant IDOR via forged organizationId) — spec §55 Q7", async () => {
    const ownerB = await makeMember(orgBId, "owner", "checkout-cross-owner-b@example.com");
    actAs(ownerB.userId, ownerB.membership);
    const { startCheckoutForPlanPrice } = await import("@/server/services/subscription-service");

    await expect(startCheckoutForPlanPrice({ organizationId: orgAId, planPriceId: activePlanPriceId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("cancelSubscription: an unauthenticated caller cannot cancel a client-supplied organization's subscription", async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    const { cancelSubscription } = await import("@/server/services/subscription-service");
    await expect(cancelSubscription({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR" });
  });

  it("cancelSubscription rejects when the organization has no active subscription", async () => {
    const owner = await makeMember(orgAId, "owner", "cancel-none-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { cancelSubscription } = await import("@/server/services/subscription-service");
    await expect(cancelSubscription({ organizationId: orgAId })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("cancelSubscription(atPeriodEnd) calls the provider and sets cancelAtPeriodEnd locally; resumeSubscription reverses it", async () => {
    const owner = await makeMember(orgAId, "owner", "cancel-resume-owner@example.com");
    actAs(owner.userId, owner.membership);

    // Seed a subscription directly (bypassing checkout — this test is
    // about cancel/resume, not checkout creation).
    const { billingAccountRepository } = await import("@/server/repositories/billing-account-repository");
    const { subscriptionRepository } = await import("@/server/repositories/subscription-repository");
    const account = await withTenantContext({ userId: owner.userId, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_seed_${generateId()}` }, tx),
    );
    await withTenantContext({ userId: owner.userId, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      subscriptionRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: account.id, provider: "STRIPE", providerSubscriptionId: `sub_seed_${generateId()}`, status: "ACTIVE" }, tx),
    );

    const { cancelSubscription, resumeSubscription } = await import("@/server/services/subscription-service");
    const canceled = await cancelSubscription({ organizationId: orgAId, atPeriodEnd: true });
    expect(canceled.cancelAtPeriodEnd).toBe(true);
    expect(mockProvider.cancelSubscription).toHaveBeenCalledWith(expect.objectContaining({ atPeriodEnd: true }));

    const resumed = await resumeSubscription({ organizationId: orgAId });
    expect(resumed.cancelAtPeriodEnd).toBe(false);
    expect(mockProvider.resumeSubscription).toHaveBeenCalled();
  });

  it("resumeSubscription rejects a subscription that isn't scheduled for cancellation", async () => {
    const owner = await makeMember(orgAId, "owner", "resume-not-scheduled-owner@example.com");
    actAs(owner.userId, owner.membership);

    const { billingAccountRepository } = await import("@/server/repositories/billing-account-repository");
    const { subscriptionRepository } = await import("@/server/repositories/subscription-repository");
    const account = await withTenantContext({ userId: owner.userId, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_seed2_${generateId()}` }, tx),
    );
    await withTenantContext({ userId: owner.userId, organizationId: orgAId, isPlatformStaff: false }, (tx) =>
      subscriptionRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: account.id, provider: "STRIPE", providerSubscriptionId: `sub_seed2_${generateId()}`, status: "ACTIVE" }, tx),
    );

    const { resumeSubscription } = await import("@/server/services/subscription-service");
    await expect(resumeSubscription({ organizationId: orgAId })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
