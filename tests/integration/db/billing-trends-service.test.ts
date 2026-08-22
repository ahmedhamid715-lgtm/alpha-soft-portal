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

let mockUser: { id: string } | null = null;
let mockMembershipsByOrg = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (organizationId) return mockMembershipsByOrg.get(organizationId) ?? null;
    return mockMembershipsByOrg.size === 1 ? [...mockMembershipsByOrg.values()][0] : null;
  }),
}));

describe.skipIf(!isDatabaseConfigured)("billing-trends-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  const planIds: string[] = [];
  let orgAId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Trends Test Org A", displayName: "Trends Test Org A", slug: `trends-org-a-${orgAId}` });
    orgIds.push(orgAId);
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

  it("getOrganizationBillingTrends: returns exactly the requested number of buckets, spanning the whole period, MRR reflecting a currently-active subscription", async () => {
    const plan = await planRepository.create({ id: generateId(), key: `trends_plan_${generateId().replace(/-/g, "_")}`.slice(0, 40), name: "Trends Test Plan" });
    planIds.push(plan.id);
    const price = await planPriceRepository.create({ id: generateId(), planId: plan.id, currency: "USD", unitAmount: 3000, interval: "MONTH", provider: "STRIPE" });

    const account = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_trends_test_${generateId()}` }, tx),
    );
    const subscription = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: account.id, provider: "STRIPE", providerSubscriptionId: `sub_trends_test_${generateId()}`, status: "ACTIVE" }, tx),
    );
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionItemRepository.create({ id: generateId(), subscriptionId: subscription.id, planPriceId: price.id, quantity: 1, provider: "STRIPE", providerItemId: `si_trends_test_${generateId()}` }, tx),
    );

    const owner = await makeMember(orgAId, "owner", "trends-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getOrganizationBillingTrends } = await import("@/server/services/billing-trends-service");
    const result = await getOrganizationBillingTrends({ organizationId: orgAId, period: "current_year", buckets: 4 });

    expect(result.mrr).toHaveLength(4);
    expect(result.mrr[0]!.bucketStart).toEqual(result.period.start);
    expect(result.mrr[3]!.bucketEnd).toEqual(result.period.end);
    // The subscription was created "now" — every bucket up to and
    // including the current one should already reflect its MRR; the
    // LAST (most recent) bucket definitely does.
    expect(result.mrr[3]!.byCurrency).toEqual([{ currency: "USD", amount: 3000 }]);
  });

  it("getOrganizationBillingTrends: a member without billing.read is denied", async () => {
    const member = await makeMember(orgAId, "member", "trends-denied-member@example.com");
    actAs(member.userId, member.membership);
    const { getOrganizationBillingTrends } = await import("@/server/services/billing-trends-service");
    await expect(getOrganizationBillingTrends({ organizationId: orgAId, period: "current_year", buckets: 4 })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("getOrganizationBillingTrends: rejects a bucket count above the fixed maximum", async () => {
    const owner = await makeMember(orgAId, "owner", "trends-max-buckets-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getOrganizationBillingTrends } = await import("@/server/services/billing-trends-service");
    await expect(getOrganizationBillingTrends({ organizationId: orgAId, period: "current_year", buckets: 999 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("getPlatformBillingTrends: requires billing.analytics.read", async () => {
    const owner = await makeMember(orgAId, "owner", "trends-platform-denied-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getPlatformBillingTrends } = await import("@/server/services/billing-trends-service");
    await expect(getPlatformBillingTrends({ period: "current_year", buckets: 4 })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("Org B's owner cannot read Org A's trends via a forged organizationId", async () => {
    const orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "Trends Test Org B", displayName: "Trends Test Org B", slug: `trends-org-b-${orgBId}` });
    orgIds.push(orgBId);
    const ownerB = await makeMember(orgBId, "owner", "trends-cross-tenant-owner@example.com");
    actAs(ownerB.userId, ownerB.membership);
    const { getOrganizationBillingTrends } = await import("@/server/services/billing-trends-service");
    await expect(getOrganizationBillingTrends({ organizationId: orgAId, period: "current_year", buckets: 4 })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });
});
