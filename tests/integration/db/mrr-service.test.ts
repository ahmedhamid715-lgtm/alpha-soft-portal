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
import { auditEventRepository } from "@/server/repositories/audit-event-repository";
import { withTenantContext } from "@/lib/tenancy/context";

/**
 * `mrr-service.ts` (Module 15) — real Postgres, real RLS. Platform-wide
 * assertions use a RESERVED, otherwise-unused currency (`GBP` — see
 * this file's own `PLATFORM_TEST_CURRENCY`) specifically so a
 * concurrently-running, unrelated test FILE (Vitest's own file-level
 * parallelism — a real, repeatedly-encountered hazard in this codebase)
 * can never pollute a platform-wide aggregate this test asserts an
 * EXACT total for. Organization-scoped assertions have no such risk
 * (each test's own fresh organization is the only source of its own
 * data) and use plain USD.
 */

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

describe.skipIf(!isDatabaseConfigured)("mrr-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  const planIds: string[] = [];
  let orgAId: string;
  let platformOrgId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "MRR Test Org A", displayName: "MRR Test Org A", slug: `mrr-org-a-${orgAId}` });
    orgIds.push(orgAId);

    const platformOrg = await organizationRepository.findPlatformOrganization();
    platformOrgId = platformOrg!.id;

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

  async function seedPlan(currency: string, unitAmount: number, interval: "MONTH" | "YEAR" = "MONTH") {
    const plan = await planRepository.create({ id: generateId(), key: `mrr_plan_${generateId().replace(/-/g, "_")}`.slice(0, 40), name: "MRR Test Plan" });
    planIds.push(plan.id);
    const price = await planPriceRepository.create({ id: generateId(), planId: plan.id, currency, unitAmount, interval, provider: "STRIPE" });
    return { plan, price };
  }

  async function seedSubscription(organizationId: string, priceId: string, status: "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED" = "ACTIVE") {
    const account = await withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_mrr_test_${generateId()}` }, tx),
    );
    const subscription = await withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.create({ id: generateId(), organizationId, billingAccountId: account.id, provider: "STRIPE", providerSubscriptionId: `sub_mrr_test_${generateId()}`, status }, tx),
    );
    await withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
      subscriptionItemRepository.create({ id: generateId(), subscriptionId: subscription.id, planPriceId: priceId, quantity: 1, provider: "STRIPE", providerItemId: `si_mrr_test_${generateId()}` }, tx),
    );
    return subscription;
  }

  it("getOrganizationMrrSummary: sums an ACTIVE subscription's monthly price", async () => {
    const { price } = await seedPlan("USD", 9900);
    await seedSubscription(orgAId, price.id, "ACTIVE");
    const owner = await makeMember(orgAId, "owner", "mrr-org-owner@example.com");
    actAs(owner.userId, owner.membership);

    const { getOrganizationMrrSummary } = await import("@/server/services/mrr-service");
    const result = await getOrganizationMrrSummary({ organizationId: orgAId });
    expect(result.byCurrency).toEqual([{ currency: "USD", mrr: 9900, arr: 9900 * 12, subscriptionCount: 1 }]);
  });

  it("getOrganizationMrrSummary: a member without billing.read is denied", async () => {
    const member = await makeMember(orgAId, "member", "mrr-org-member@example.com");
    actAs(member.userId, member.membership);
    const { getOrganizationMrrSummary } = await import("@/server/services/mrr-service");
    await expect(getOrganizationMrrSummary({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("getOrganizationMrrSummary: Org B's owner cannot read Org A's MRR via a forged organizationId", async () => {
    const orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "MRR Test Org B", displayName: "MRR Test Org B", slug: `mrr-org-b-${orgBId}` });
    orgIds.push(orgBId);
    const ownerB = await makeMember(orgBId, "owner", "mrr-org-b-owner@example.com");
    actAs(ownerB.userId, ownerB.membership);
    const { getOrganizationMrrSummary } = await import("@/server/services/mrr-service");
    await expect(getOrganizationMrrSummary({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("getPlatformMrrSummary: requires billing.analytics.read — an organization owner is denied", async () => {
    const owner = await makeMember(orgAId, "owner", "mrr-platform-denied-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getPlatformMrrSummary } = await import("@/server/services/mrr-service");
    await expect(getPlatformMrrSummary()).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("getPlatformMrrSummary: includes a reserved-currency subscription's contribution, isolated from cross-file pollution", async () => {
    const { price } = await seedPlan(PLATFORM_TEST_CURRENCY, 15000);
    await seedSubscription(orgAId, price.id, "ACTIVE");
    const admin = await makeMember(platformOrgId, "platform_admin", "mrr-platform-admin@example.com");
    actAs(admin.userId, admin.membership);

    const { getPlatformMrrSummary } = await import("@/server/services/mrr-service");
    const result = await getPlatformMrrSummary();
    const gbpRow = result.byCurrency.find((r) => r.currency === PLATFORM_TEST_CURRENCY);
    expect(gbpRow).toEqual({ currency: PLATFORM_TEST_CURRENCY, mrr: 15000, arr: 15000 * 12, subscriptionCount: 1 });
  });

  it("getPlatformMrrSummary: a TRIALING subscription in the reserved currency contributes nothing", async () => {
    const { price } = await seedPlan(PLATFORM_TEST_CURRENCY, 20000);
    await seedSubscription(orgAId, price.id, "TRIALING");
    const owner = await makeMember(platformOrgId, "platform_owner", "mrr-platform-trial-owner@example.com");
    actAs(owner.userId, owner.membership);

    const { getPlatformMrrSummary } = await import("@/server/services/mrr-service");
    const result = await getPlatformMrrSummary();
    expect(result.byCurrency.find((r) => r.currency === PLATFORM_TEST_CURRENCY)).toBeUndefined();
  });

  it("getOrganizationMrrMovement: a subscription created within 'today' is classified NEW", async () => {
    const { price } = await seedPlan("USD", 5000);
    await seedSubscription(orgAId, price.id, "ACTIVE");
    const owner = await makeMember(orgAId, "owner", "mrr-movement-new-owner@example.com");
    actAs(owner.userId, owner.membership);

    const { getOrganizationMrrMovement } = await import("@/server/services/mrr-service");
    const result = await getOrganizationMrrMovement({ organizationId: orgAId, period: "today" });
    expect(result.movements.some((m) => m.type === "NEW" && m.currentMrr === 5000)).toBe(true);
  });

  it("getOrganizationMrrMovement: a real billing.plan.changed audit event within the period is classified EXPANSION or CONTRACTION", async () => {
    const { price: lowPrice } = await seedPlan("USD", 4000);
    const { price: highPrice } = await seedPlan("USD", 9000);
    const subscription = await seedSubscription(orgAId, highPrice.id, "ACTIVE"); // current state already reflects the "new" price, exactly like the real webhook-reconciled flow

    await auditEventRepository.create({
      id: generateId(),
      organizationId: orgAId,
      actorType: "SYSTEM",
      actorUserId: null,
      actorServiceId: null,
      actorDisplayName: "Test fixture",
      action: "billing.plan.changed",
      category: "BILLING",
      outcome: "SUCCESS",
      resourceType: "subscription",
      resourceId: subscription.id,
      resourceName: null,
      previousState: { planPriceId: lowPrice.id },
      newState: { planPriceId: highPrice.id },
      metadata: null,
      ipAddress: null,
      userAgent: null,
      requestId: generateId(),
      correlationId: generateId(),
    });

    const owner = await makeMember(orgAId, "owner", "mrr-movement-expansion-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getOrganizationMrrMovement } = await import("@/server/services/mrr-service");
    const result = await getOrganizationMrrMovement({ organizationId: orgAId, period: "today" });
    const expansion = result.movements.find((m) => m.type === "EXPANSION");
    expect(expansion).toMatchObject({ previousMrr: 4000, currentMrr: 9000, delta: 5000 });
  });

  it("getOrganizationMrrMovement: a subscription canceled within the period is classified CHURN, valued at its last known MRR", async () => {
    const { price } = await seedPlan("USD", 6000);
    const subscription = await seedSubscription(orgAId, price.id, "ACTIVE");
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.applyProviderState(subscription.id, { status: "CANCELED", currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, canceledAt: new Date(), trialStart: null, trialEnd: null, providerEventTimestamp: new Date() }, tx),
    );

    const owner = await makeMember(orgAId, "owner", "mrr-movement-churn-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getOrganizationMrrMovement } = await import("@/server/services/mrr-service");
    const result = await getOrganizationMrrMovement({ organizationId: orgAId, period: "today" });
    expect(result.movements.some((m) => m.type === "CHURN" && m.delta === -6000)).toBe(true);
  });

  it("getPlatformMrrMovement: requires billing.analytics.read", async () => {
    const owner = await makeMember(orgAId, "owner", "mrr-movement-platform-denied@example.com");
    actAs(owner.userId, owner.membership);
    const { getPlatformMrrMovement } = await import("@/server/services/mrr-service");
    await expect(getPlatformMrrMovement({ period: "today" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });
});
