import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { subscriptionRepository, subscriptionItemRepository } from "@/server/repositories/subscription-repository";
import { planRepository, planPriceRepository } from "@/server/repositories/plan-repository";
import { withTenantContext } from "@/lib/tenancy/context";

/**
 * `previewPlanChange()`/`changeSubscriptionPlan()` (Module 14 spec
 * §5/§35) — non-concurrency correctness: permission gating, a forged
 * `planPriceId` (unknown / inactive / cross-org), the "already on this
 * price" rejection, and that a preview never mutates anything while an
 * apply always audits.
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
  changeSubscription: vi.fn(async () => undefined),
  getSubscription: vi.fn(),
  extendTrial: vi.fn(),
  retryInvoicePayment: vi.fn(),
};
vi.mock("@/lib/billing/provider/stripe/provider", () => ({ stripeBillingProvider: mockProvider }));

describe.skipIf(!isDatabaseConfigured)("subscription plan change (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  const planIds: string[] = [];
  let orgAId: string;
  let orgBId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    vi.clearAllMocks();
    mockProvider.changeSubscription.mockResolvedValue(undefined);
    mockProvider.previewSubscriptionChange.mockResolvedValue({
      available: true,
      currency: "USD",
      immediateChangeAmount: 1500,
      totalAmount: 2500,
      effectiveAt: Math.floor(Date.now() / 1000),
    });

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Plan Change Org A", displayName: "Plan Change Org A", slug: `plan-change-org-a-${orgAId}` });
    orgIds.push(orgAId);
    orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "Plan Change Org B", displayName: "Plan Change Org B", slug: `plan-change-org-b-${orgBId}` });
    orgIds.push(orgBId);

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));
  });

  afterEach(async () => {
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    if (planIds.length) await db.plan.deleteMany({ where: { id: { in: planIds } } });
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

  async function seedSubscriptionOnPriceA(organizationId: string) {
    const account = await withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_planchange_${generateId()}` }, tx),
    );
    const subscription = await withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.create({ id: generateId(), organizationId, billingAccountId: account.id, provider: "STRIPE", providerSubscriptionId: `sub_planchange_${generateId()}`, status: "ACTIVE" }, tx),
    );

    const plan = await planRepository.create({ id: generateId(), key: `planchange_plan_${generateId().replace(/-/g, "_")}`.slice(0, 40), name: "Plan Change Plan" });
    planIds.push(plan.id);
    const priceA = await planPriceRepository.create({ id: generateId(), planId: plan.id, currency: "USD", unitAmount: 1000, interval: "MONTH", provider: "STRIPE", providerPriceId: `price_planchange_a_${generateId()}` });
    const priceB = await planPriceRepository.create({ id: generateId(), planId: plan.id, currency: "USD", unitAmount: 2000, interval: "MONTH", provider: "STRIPE", providerPriceId: `price_planchange_b_${generateId()}` });
    const inactivePriceCreated = await planPriceRepository.create({ id: generateId(), planId: plan.id, currency: "USD", unitAmount: 3000, interval: "MONTH", provider: "STRIPE", providerPriceId: `price_planchange_inactive_${generateId()}` });
    const inactivePrice = await planPriceRepository.update(inactivePriceCreated.id, { active: false });

    await withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
      subscriptionItemRepository.create({ id: generateId(), subscriptionId: subscription.id, planPriceId: priceA.id, quantity: 1, provider: "STRIPE", providerItemId: `si_planchange_${generateId()}` }, tx),
    );

    return { subscription, priceA, priceB, inactivePrice };
  }

  it("previewPlanChange (billing.read) returns the provider's preview and never calls changeSubscription", async () => {
    const { priceB } = await seedSubscriptionOnPriceA(orgAId);
    const admin = await makeMember(orgAId, "admin", "planchange-preview-admin@example.com");
    actAs(admin.userId, admin.membership);
    const { previewPlanChange } = await import("@/server/services/subscription-service");

    const preview = await previewPlanChange({ organizationId: orgAId, planPriceId: priceB.id });
    expect(preview.available).toBe(true);
    expect(preview.immediateChangeAmount).toBe(1500);
    expect(preview.totalAmount).toBe(2500);
    expect(mockProvider.previewSubscriptionChange).toHaveBeenCalledTimes(1);
    expect(mockProvider.changeSubscription).not.toHaveBeenCalled();
  });

  it("previewPlanChange surfaces an honest available:false rather than fabricating numbers when the provider can't preview", async () => {
    mockProvider.previewSubscriptionChange.mockResolvedValueOnce({ available: false, currency: null, immediateChangeAmount: null, totalAmount: null, effectiveAt: null });
    const { priceB } = await seedSubscriptionOnPriceA(orgAId);
    const owner = await makeMember(orgAId, "owner", "planchange-unavailable-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { previewPlanChange } = await import("@/server/services/subscription-service");

    const preview = await previewPlanChange({ organizationId: orgAId, planPriceId: priceB.id });
    expect(preview).toEqual({ available: false, currency: null, immediateChangeAmount: null, totalAmount: null, effectiveAt: null });
  });

  it("a member (no billing.manage) cannot apply a plan change", async () => {
    const { priceB } = await seedSubscriptionOnPriceA(orgAId);
    const member = await makeMember(orgAId, "member", "planchange-forbidden-member@example.com");
    actAs(member.userId, member.membership);
    const { changeSubscriptionPlan } = await import("@/server/services/subscription-service");

    await expect(changeSubscriptionPlan({ organizationId: orgAId, planPriceId: priceB.id })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    expect(mockProvider.changeSubscription).not.toHaveBeenCalled();
  });

  it("an owner CAN apply a plan change; it calls the provider once and audits billing.plan.changed", async () => {
    const { priceB } = await seedSubscriptionOnPriceA(orgAId);
    const owner = await makeMember(orgAId, "owner", "planchange-apply-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { changeSubscriptionPlan } = await import("@/server/services/subscription-service");

    await changeSubscriptionPlan({ organizationId: orgAId, planPriceId: priceB.id });
    expect(mockProvider.changeSubscription).toHaveBeenCalledTimes(1);
    expect(mockProvider.changeSubscription).toHaveBeenCalledWith(expect.objectContaining({ providerPriceId: priceB.providerPriceId }));

    const auditEvent = await db.auditEvent.findFirst({ where: { organizationId: orgAId, action: "billing.plan.changed" } });
    expect(auditEvent).not.toBeNull();
  });

  it("changing to the SAME price the subscription is already on is rejected", async () => {
    const { priceA } = await seedSubscriptionOnPriceA(orgAId);
    const owner = await makeMember(orgAId, "owner", "planchange-same-price-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { changeSubscriptionPlan } = await import("@/server/services/subscription-service");

    await expect(changeSubscriptionPlan({ organizationId: orgAId, planPriceId: priceA.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mockProvider.changeSubscription).not.toHaveBeenCalled();
  });

  it("an inactive plan price is rejected — never sold, even to change into", async () => {
    const { inactivePrice } = await seedSubscriptionOnPriceA(orgAId);
    const owner = await makeMember(orgAId, "owner", "planchange-inactive-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { changeSubscriptionPlan } = await import("@/server/services/subscription-service");

    await expect(changeSubscriptionPlan({ organizationId: orgAId, planPriceId: inactivePrice.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockProvider.changeSubscription).not.toHaveBeenCalled();
  });

  it("a forged, entirely unknown planPriceId is rejected", async () => {
    await seedSubscriptionOnPriceA(orgAId);
    const owner = await makeMember(orgAId, "owner", "planchange-unknown-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { changeSubscriptionPlan } = await import("@/server/services/subscription-service");

    await expect(changeSubscriptionPlan({ organizationId: orgAId, planPriceId: "00000000-0000-0000-0000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Org B's owner cannot change Org A's subscription plan via a forged organizationId (cross-tenant IDOR)", async () => {
    const { priceB } = await seedSubscriptionOnPriceA(orgAId);
    const ownerB = await makeMember(orgBId, "owner", "planchange-cross-tenant-owner@example.com");
    actAs(ownerB.userId, ownerB.membership);
    const { changeSubscriptionPlan } = await import("@/server/services/subscription-service");

    await expect(changeSubscriptionPlan({ organizationId: orgAId, planPriceId: priceB.id })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("an organization with no subscription at all is rejected with a clear domain error, not a crash", async () => {
    const account = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_nosub_${generateId()}` }, tx),
    );
    void account;
    const owner = await makeMember(orgAId, "owner", "planchange-nosub-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { changeSubscriptionPlan } = await import("@/server/services/subscription-service");

    await expect(changeSubscriptionPlan({ organizationId: orgAId, planPriceId: "00000000-0000-0000-0000-000000000000" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
