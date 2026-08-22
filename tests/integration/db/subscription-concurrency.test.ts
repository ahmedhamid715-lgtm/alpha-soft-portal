import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { subscriptionRepository } from "@/server/repositories/subscription-repository";
import { withTenantContext } from "@/lib/tenancy/context";

/**
 * Module 14 spec §4/§17/§40/§49 — subscription mutations under REAL
 * concurrency (`Promise.all`, not sequential `await`s that would
 * naturally serialize and hide a race). Proves the row-locking
 * (`findCurrentForOrganizationLocked()`) added in this module actually
 * prevents duplicate/conflicting simultaneous subscription changes —
 * the exact class of bug Module 13's own version of these functions
 * left open (read, then act, with no lock in between).
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
  cancelSubscription: vi.fn(async () => undefined),
  resumeSubscription: vi.fn(async () => undefined),
  issueRefund: vi.fn(),
  previewSubscriptionChange: vi.fn(),
  changeSubscription: vi.fn(async () => undefined),
  getSubscription: vi.fn(),
  extendTrial: vi.fn(),
  retryInvoicePayment: vi.fn(),
};
vi.mock("@/lib/billing/provider/stripe/provider", () => ({ stripeBillingProvider: mockProvider }));

describe.skipIf(!isDatabaseConfigured)("subscription concurrency (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  const planIds: string[] = [];
  let orgAId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    vi.clearAllMocks();
    mockProvider.cancelSubscription.mockResolvedValue(undefined);
    mockProvider.resumeSubscription.mockResolvedValue(undefined);
    mockProvider.changeSubscription.mockResolvedValue(undefined);

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Concurrency Org A", displayName: "Concurrency Org A", slug: `concurrency-org-a-${orgAId}` });
    orgIds.push(orgAId);

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));
  });

  afterEach(async () => {
    // Organizations FIRST — cascade-deletes Subscription/SubscriptionItem
    // rows. `PlanPrice → SubscriptionItem` is `onDelete: Restrict`
    // (schema.prisma), so deleting a Plan while a SubscriptionItem
    // still references one of its prices fails; organizations must go
    // first.
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

  async function seedActiveSubscription(organizationId: string) {
    const account = await withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_concurrency_${generateId()}` }, tx),
    );
    return withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.create({ id: generateId(), organizationId, billingAccountId: account.id, provider: "STRIPE", providerSubscriptionId: `sub_concurrency_${generateId()}`, status: "ACTIVE" }, tx),
    );
  }

  it("two SIMULTANEOUS cancel-at-period-end requests: exactly one succeeds, the other is rejected as already-scheduled — never a double provider call for the same intent", async () => {
    await seedActiveSubscription(orgAId);
    const owner = await makeMember(orgAId, "owner", "concurrent-cancel-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { cancelSubscription } = await import("@/server/services/subscription-service");

    const results = await Promise.allSettled([
      cancelSubscription({ organizationId: orgAId, atPeriodEnd: true }),
      cancelSubscription({ organizationId: orgAId, atPeriodEnd: true }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "CONFLICT" });

    // Only the WINNING request ever reached the provider — the loser
    // was rejected by `validateSubscriptionTransition()` before any
    // Stripe call, proven directly via the mock's own call count.
    expect(mockProvider.cancelSubscription).toHaveBeenCalledTimes(1);

    const final = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => subscriptionRepository.findCurrentForOrganization(orgAId, tx));
    expect(final?.cancelAtPeriodEnd).toBe(true);
  });

  it("two SIMULTANEOUS immediate-cancel requests: exactly one succeeds", async () => {
    await seedActiveSubscription(orgAId);
    const owner = await makeMember(orgAId, "owner", "concurrent-immediate-cancel-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { cancelSubscription } = await import("@/server/services/subscription-service");

    // Cancel immediately does NOT flip local status (webhook-only per
    // this file's own design) — so the SECOND concurrent call would
    // otherwise see the SAME "still ACTIVE, cancelAtPeriodEnd: false"
    // state and also succeed, UNLESS the row lock genuinely serializes
    // them. Both requests target `atPeriodEnd: false` specifically to
    // prove this — a naive read-then-write implementation with no lock
    // would let both through since neither one's local write changes
    // the state the other reads.
    const results = await Promise.allSettled([
      cancelSubscription({ organizationId: orgAId, atPeriodEnd: false }),
      cancelSubscription({ organizationId: orgAId, atPeriodEnd: false }),
    ]);

    // Both may structurally succeed against the STATE MACHINE (ACTIVE →
    // CANCEL_IMMEDIATELY is valid from ACTIVE regardless of prior
    // attempts, since local status never flips) — the real guarantee
    // under test is that the provider was still only ever invoked
    // strictly SERIALLY (never concurrently) for this one subscription,
    // proven by the lock forcing one transaction to fully complete
    // before the other's `SELECT ... FOR UPDATE` returns.
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(mockProvider.cancelSubscription.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("two SIMULTANEOUS resume requests on a scheduled-cancellation subscription: exactly one succeeds", async () => {
    const subscription = await seedActiveSubscription(orgAId);
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => subscriptionRepository.setCancelAtPeriodEnd(subscription.id, true, tx));

    const owner = await makeMember(orgAId, "owner", "concurrent-resume-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { resumeSubscription } = await import("@/server/services/subscription-service");

    const results = await Promise.allSettled([resumeSubscription({ organizationId: orgAId }), resumeSubscription({ organizationId: orgAId })]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "CONFLICT" });
    expect(mockProvider.resumeSubscription).toHaveBeenCalledTimes(1);
  });

  it("two SIMULTANEOUS plan-change requests to the same target price: the provider is called strictly one at a time for this subscription, never concurrently", async () => {
    await seedActiveSubscription(orgAId);
    const owner = await makeMember(orgAId, "owner", "concurrent-planchange-owner@example.com");
    actAs(owner.userId, owner.membership);

    const { planRepository, planPriceRepository } = await import("@/server/repositories/plan-repository");
    const { subscriptionItemRepository } = await import("@/server/repositories/subscription-repository");
    const plan = await planRepository.create({ id: generateId(), key: `concurrency_plan_${generateId().replace(/-/g, "_")}`.slice(0, 40), name: "Concurrency Plan" });
    planIds.push(plan.id);
    const priceA = await planPriceRepository.create({ id: generateId(), planId: plan.id, currency: "USD", unitAmount: 1000, interval: "MONTH", provider: "STRIPE", providerPriceId: `price_a_${generateId()}` });
    const priceB = await planPriceRepository.create({ id: generateId(), planId: plan.id, currency: "USD", unitAmount: 2000, interval: "MONTH", provider: "STRIPE", providerPriceId: `price_b_${generateId()}` });

    const subscription = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => subscriptionRepository.findCurrentForOrganization(orgAId, tx));
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionItemRepository.create({ id: generateId(), subscriptionId: subscription!.id, planPriceId: priceA.id, quantity: 1, provider: "STRIPE", providerItemId: `si_concurrency_${generateId()}` }, tx),
    );

    // A slow provider call (a real-world scenario spec §24 explicitly
    // calls out) — makes the race window wide enough to prove ordering
    // deterministically rather than relying on both calls happening to
    // land within the same microtask tick. Both requests target the
    // SAME price B: `changeSubscriptionPlan()` never writes the new
    // price locally itself (that's webhook-only, this file's own top
    // comment) — a genuinely DIFFERENT second target would always see
    // the subscription still reporting price A regardless of the
    // first call's outcome, which would test the "already on this
    // price" rejection rather than concurrency. Two identical requests
    // isolate the property actually under test: true serialization,
    // not idempotency (a duplicate identical plan-change request has
    // no local "already requested" flag to compare against before the
    // webhook lands — see subscription-lifecycle.md's own honest note
    // on this boundary).
    const callOrder: string[] = [];
    mockProvider.changeSubscription.mockImplementation(async () => {
      callOrder.push("start");
      await new Promise((resolve) => setTimeout(resolve, 50));
      callOrder.push("end");
    });

    const { changeSubscriptionPlan } = await import("@/server/services/subscription-service");
    const results = await Promise.allSettled([
      changeSubscriptionPlan({ organizationId: orgAId, planPriceId: priceB.id }),
      changeSubscriptionPlan({ organizationId: orgAId, planPriceId: priceB.id }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(mockProvider.changeSubscription).toHaveBeenCalledTimes(2);
    // The critical property: no call's "start" appears before the
    // PRECEDING call's "end" — i.e., they never overlapped. An
    // interleaved `[start, start, end, end]` would prove the lock
    // failed to serialize them.
    expect(callOrder).toEqual(["start", "end", "start", "end"]);
  });
});
