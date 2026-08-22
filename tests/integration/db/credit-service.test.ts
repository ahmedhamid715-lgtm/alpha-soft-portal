import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { withTenantContext } from "@/lib/tenancy/context";

/**
 * `credit-service.ts` (Module 14) — permission gating
 * (`billing.credit.manage`, platform_admin+), currency validation,
 * balance computation, and the "adjust an already-adjusted entry"
 * rejection (the sequential, non-racing version — see
 * `credit-concurrency.test.ts` for the real concurrent race).
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
  extendTrial: vi.fn(async () => undefined),
  retryInvoicePayment: vi.fn(),
};
vi.mock("@/lib/billing/provider/stripe/provider", () => ({ stripeBillingProvider: mockProvider }));

describe.skipIf(!isDatabaseConfigured)("credit-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let orgBId: string;
  let platformOrgId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    vi.clearAllMocks();

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Credit Test Org A", displayName: "Credit Test Org A", slug: `credit-org-a-${orgAId}` });
    orgIds.push(orgAId);
    orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "Credit Test Org B", displayName: "Credit Test Org B", slug: `credit-org-b-${orgBId}` });
    orgIds.push(orgBId);

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

  async function seedBillingAccount(organizationId: string, currency = "USD") {
    return withTenantContext({ userId: null, organizationId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId, currency, provider: "STRIPE", providerCustomerId: `cus_credit_test_${generateId()}` }, tx),
    );
  }

  it("platform_admin can issue a credit; the organization's own owner sees the balance reflected (billing.read is ORGANIZATION-scoped, not automatically held by platform staff)", async () => {
    await seedBillingAccount(orgAId);
    const admin = await makeMember(platformOrgId, "platform_admin", "credit-issue-admin@example.com");
    actAs(admin.userId, admin.membership);
    const { issueCredit } = await import("@/server/services/credit-service");

    const entry = await issueCredit({ organizationId: orgAId, amount: 5_000, currency: "USD", reason: "Goodwill credit" });
    expect(entry.type).toBe("CREDIT");
    expect(entry.initiatedByUserId).toBe(admin.userId);

    const owner = await makeMember(orgAId, "owner", "credit-issue-balance-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getCreditBalance } = await import("@/server/services/credit-service");
    const balance = await getCreditBalance({ organizationId: orgAId });
    expect(balance.balance).toBe(5_000);
  });

  it("support_admin (billing.readPlatform only) cannot issue a credit", async () => {
    await seedBillingAccount(orgAId);
    const support = await makeMember(platformOrgId, "support_admin", "credit-issue-support@example.com");
    actAs(support.userId, support.membership);
    const { issueCredit } = await import("@/server/services/credit-service");

    await expect(issueCredit({ organizationId: orgAId, amount: 1_000, currency: "USD", reason: "Should fail" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("an organization's own owner cannot issue a credit to themselves — platform-staff-only, same as refunds", async () => {
    await seedBillingAccount(orgAId);
    const owner = await makeMember(orgAId, "owner", "credit-issue-org-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { issueCredit } = await import("@/server/services/credit-service");

    await expect(issueCredit({ organizationId: orgAId, amount: 1_000, currency: "USD", reason: "Self-issued, should fail" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("issuing a credit in a currency that doesn't match the billing account's own currency is rejected", async () => {
    await seedBillingAccount(orgAId, "USD");
    const owner = await makeMember(platformOrgId, "platform_admin", "credit-currency-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { issueCredit } = await import("@/server/services/credit-service");

    await expect(issueCredit({ organizationId: orgAId, amount: 1_000, currency: "EUR", reason: "Wrong currency" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("adjustCredit reverses an entry via a compensating entry; the original is never mutated", async () => {
    await seedBillingAccount(orgAId);
    const platformOwner = await makeMember(platformOrgId, "platform_admin", "credit-adjust-owner@example.com");
    actAs(platformOwner.userId, platformOwner.membership);
    const { issueCredit, adjustCredit, getCreditBalance } = await import("@/server/services/credit-service");

    const original = await issueCredit({ organizationId: orgAId, amount: 8_000, currency: "USD", reason: "Original credit" });
    const compensating = await adjustCredit({ organizationId: orgAId, entryId: original.id, reason: "Issued in error" });
    expect(compensating.type).toBe("DEBIT");
    expect(compensating.amount).toBe(8_000);
    expect(compensating.relatedEntryId).toBe(original.id);

    const stillOriginal = await db.creditLedgerEntry.findUnique({ where: { id: original.id } });
    expect(stillOriginal?.type).toBe("CREDIT"); // never mutated — spec §11

    const orgOwner = await makeMember(orgAId, "owner", "credit-adjust-balance-owner@example.com");
    actAs(orgOwner.userId, orgOwner.membership);
    const balance = await getCreditBalance({ organizationId: orgAId });
    expect(balance.balance).toBe(0);
  });

  it("adjusting an entry that has already been adjusted (sequential) is rejected", async () => {
    await seedBillingAccount(orgAId);
    const owner = await makeMember(platformOrgId, "platform_admin", "credit-double-adjust-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { issueCredit, adjustCredit } = await import("@/server/services/credit-service");

    const original = await issueCredit({ organizationId: orgAId, amount: 1_000, currency: "USD", reason: "Original" });
    await adjustCredit({ organizationId: orgAId, entryId: original.id, reason: "First adjustment" });
    await expect(adjustCredit({ organizationId: orgAId, entryId: original.id, reason: "Second adjustment attempt" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a compensating entry itself cannot be adjusted", async () => {
    await seedBillingAccount(orgAId);
    const owner = await makeMember(platformOrgId, "platform_admin", "credit-adjust-compensating-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { issueCredit, adjustCredit } = await import("@/server/services/credit-service");

    const original = await issueCredit({ organizationId: orgAId, amount: 1_000, currency: "USD", reason: "Original" });
    const compensating = await adjustCredit({ organizationId: orgAId, entryId: original.id, reason: "First adjustment" });
    await expect(adjustCredit({ organizationId: orgAId, entryId: compensating.id, reason: "Adjusting the adjustment" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("a forged entryId belonging to another organization is rejected (cross-tenant IDOR)", async () => {
    await seedBillingAccount(orgAId);
    await seedBillingAccount(orgBId);
    const ownerForA = await makeMember(platformOrgId, "platform_admin", "credit-cross-a-owner@example.com");
    actAs(ownerForA.userId, ownerForA.membership);
    const { issueCredit, adjustCredit } = await import("@/server/services/credit-service");
    const entryInA = await issueCredit({ organizationId: orgAId, amount: 1_000, currency: "USD", reason: "Org A credit" });

    await expect(adjustCredit({ organizationId: orgBId, entryId: entryInA.id, reason: "Forged cross-tenant adjustment" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("extendTrial requires billing.credit.manage and rejects a non-trialing subscription", async () => {
    const account = await seedBillingAccount(orgAId);
    const { subscriptionRepository } = await import("@/server/repositories/subscription-repository");
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: account.id, provider: "STRIPE", providerSubscriptionId: `sub_trial_test_${generateId()}`, status: "ACTIVE" }, tx),
    );

    const owner = await makeMember(platformOrgId, "platform_admin", "trial-extend-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { extendTrial } = await import("@/server/services/credit-service");

    await expect(extendTrial({ organizationId: orgAId, additionalDays: 7, reason: "Should fail — not trialing" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mockProvider.extendTrial).not.toHaveBeenCalled();
  });

  it("extendTrial calls the provider and audits when the subscription IS trialing", async () => {
    const account = await seedBillingAccount(orgAId);
    const { subscriptionRepository } = await import("@/server/repositories/subscription-repository");
    const trialEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const sub = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: account.id, provider: "STRIPE", providerSubscriptionId: `sub_trial_test2_${generateId()}`, status: "TRIALING" }, tx),
    );
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.applyProviderState(sub.id, { status: "TRIALING", currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, canceledAt: null, trialStart: new Date(), trialEnd, providerEventTimestamp: new Date() }, tx),
    );

    const owner = await makeMember(platformOrgId, "platform_admin", "trial-extend-valid-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { extendTrial } = await import("@/server/services/credit-service");

    await extendTrial({ organizationId: orgAId, additionalDays: 7, reason: "Goodwill extension" });
    expect(mockProvider.extendTrial).toHaveBeenCalledWith(expect.objectContaining({ providerSubscriptionId: sub.providerSubscriptionId }));

    const auditEvent = await db.auditEvent.findFirst({ where: { organizationId: orgAId, action: "billing.trial.extended" } });
    expect(auditEvent).not.toBeNull();
  });
});
