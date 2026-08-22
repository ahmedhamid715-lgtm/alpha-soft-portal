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
import { auditEventRepository } from "@/server/repositories/audit-event-repository";
import { withTenantContext } from "@/lib/tenancy/context";

/**
 * `billing-reconciliation-service.ts` (Module 14 spec §39) —
 * `reconcileOrganizationBilling()` is READ-ONLY: it must never mutate
 * `Subscription`/`BillingAccount`, only ever report a diff between the
 * local row and whatever `stripeBillingProvider.getSubscription()`
 * returns.
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

describe.skipIf(!isDatabaseConfigured)("billing-reconciliation-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let platformOrgId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    vi.clearAllMocks();

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Reconciliation Org A", displayName: "Reconciliation Org A", slug: `reconciliation-org-a-${orgAId}` });
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

  it("requires billing.readPlatform — an organization owner (org-scoped billing.read only) is denied", async () => {
    const owner = await makeMember(orgAId, "owner", "reconcile-org-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { reconcileOrganizationBilling } = await import("@/server/services/billing-reconciliation-service");
    await expect(reconcileOrganizationBilling({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("an organization with no billing account yet reports hasBillingAccount: false and no divergence", async () => {
    const support = await makeMember(platformOrgId, "support_admin", "reconcile-no-account@example.com");
    actAs(support.userId, support.membership);
    const { reconcileOrganizationBilling } = await import("@/server/services/billing-reconciliation-service");

    const result = await reconcileOrganizationBilling({ organizationId: orgAId });
    expect(result.hasBillingAccount).toBe(false);
    expect(result.hasLocalSubscription).toBe(false);
    expect(result.divergences).toBeNull();
    expect(mockProvider.getSubscription).not.toHaveBeenCalled();
  });

  it("a billing account with no subscription yet reports hasLocalSubscription: false and never calls the provider", async () => {
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_reconcile_${generateId()}` }, tx),
    );

    const support = await makeMember(platformOrgId, "support_admin", "reconcile-no-sub@example.com");
    actAs(support.userId, support.membership);
    const { reconcileOrganizationBilling } = await import("@/server/services/billing-reconciliation-service");

    const result = await reconcileOrganizationBilling({ organizationId: orgAId });
    expect(result.hasBillingAccount).toBe(true);
    expect(result.hasLocalSubscription).toBe(false);
    expect(result.divergences).toBeNull();
    expect(mockProvider.getSubscription).not.toHaveBeenCalled();
  });

  it("a matching local and remote subscription (identical status/flags/period) reports NO divergence", async () => {
    const account = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_reconcile_match_${generateId()}` }, tx),
    );
    const periodEnd = new Date("2027-01-01T00:00:00.000Z");
    const sub = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: account.id, provider: "STRIPE", providerSubscriptionId: `sub_reconcile_match_${generateId()}`, status: "ACTIVE" }, tx),
    );
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.applyProviderState(sub.id, { status: "ACTIVE", currentPeriodStart: new Date("2026-12-01T00:00:00.000Z"), currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, canceledAt: null, trialStart: null, trialEnd: null, providerEventTimestamp: new Date() }, tx),
    );

    mockProvider.getSubscription.mockResolvedValueOnce({
      providerSubscriptionId: sub.providerSubscriptionId,
      status: "ACTIVE",
      cancelAtPeriodEnd: false,
      currentPeriodStart: Math.floor(new Date("2026-12-01T00:00:00.000Z").getTime() / 1000),
      currentPeriodEnd: Math.floor(periodEnd.getTime() / 1000),
    });

    const platformAdmin = await makeMember(platformOrgId, "platform_admin", "reconcile-match-admin@example.com");
    actAs(platformAdmin.userId, platformAdmin.membership);
    const { reconcileOrganizationBilling } = await import("@/server/services/billing-reconciliation-service");

    const result = await reconcileOrganizationBilling({ organizationId: orgAId });
    expect(result.hasLocalSubscription).toBe(true);
    expect(result.hasRemoteSubscription).toBe(true);
    expect(result.divergences).toEqual([]);

    // Read-only — the local row must be untouched.
    const stillLocal = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => subscriptionRepository.findCurrentForOrganization(orgAId, tx));
    expect(stillLocal?.status).toBe("ACTIVE");

    // A routine "no divergence" check is deliberately NOT audited (see
    // the `billing.reconciliation.divergence_detected` catalog entry's
    // own reasoning) — only a REAL divergence is.
    const events = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      auditEventRepository.list({ limit: 10 }, { organizationId: orgAId, action: "billing.reconciliation.divergence_detected" }, tx),
    );
    expect(events.items).toHaveLength(0);
  });

  it("a status divergence (local ACTIVE, remote PAST_DUE) is reported field-by-field", async () => {
    const account = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_reconcile_diverge_${generateId()}` }, tx),
    );
    const sub = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: account.id, provider: "STRIPE", providerSubscriptionId: `sub_reconcile_diverge_${generateId()}`, status: "ACTIVE" }, tx),
    );
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.applyProviderState(sub.id, { status: "ACTIVE", currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, canceledAt: null, trialStart: null, trialEnd: null, providerEventTimestamp: new Date() }, tx),
    );

    mockProvider.getSubscription.mockResolvedValueOnce({
      providerSubscriptionId: sub.providerSubscriptionId,
      status: "PAST_DUE",
      cancelAtPeriodEnd: false,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });

    const platformOwner = await makeMember(platformOrgId, "platform_admin", "reconcile-diverge-owner@example.com");
    actAs(platformOwner.userId, platformOwner.membership);
    const { reconcileOrganizationBilling } = await import("@/server/services/billing-reconciliation-service");

    const result = await reconcileOrganizationBilling({ organizationId: orgAId });
    expect(result.divergences).toEqual([{ field: "status", local: "ACTIVE", remote: "PAST_DUE" }]);

    // Still read-only, even in the presence of a real divergence — the
    // local row is untouched; only `billing-webhook-service.ts` may ever
    // write it (spec §39's "detect, never silently auto-repair").
    const stillLocal = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => subscriptionRepository.findCurrentForOrganization(orgAId, tx));
    expect(stillLocal?.status).toBe("ACTIVE");

    // The real divergence itself IS audited, attributed to the caller.
    const events = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      auditEventRepository.list({ limit: 10 }, { organizationId: orgAId, action: "billing.reconciliation.divergence_detected" }, tx),
    );
    expect(events.items).toHaveLength(1);
    expect(events.items[0]?.actorUserId).toBe(platformOwner.userId);
    expect(events.items[0]?.resourceId).toBe(sub.id);
  });

  it("a local subscription with no matching remote Stripe object is a genuine, reported divergence", async () => {
    const account = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      billingAccountRepository.create({ id: generateId(), organizationId: orgAId, currency: "USD", provider: "STRIPE", providerCustomerId: `cus_reconcile_missing_${generateId()}` }, tx),
    );
    const sub = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.create({ id: generateId(), organizationId: orgAId, billingAccountId: account.id, provider: "STRIPE", providerSubscriptionId: `sub_reconcile_missing_${generateId()}`, status: "ACTIVE" }, tx),
    );
    await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      subscriptionRepository.applyProviderState(sub.id, { status: "ACTIVE", currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, canceledAt: null, trialStart: null, trialEnd: null, providerEventTimestamp: new Date() }, tx),
    );
    mockProvider.getSubscription.mockResolvedValueOnce(null);

    const support = await makeMember(platformOrgId, "support_admin", "reconcile-missing-remote@example.com");
    actAs(support.userId, support.membership);
    const { reconcileOrganizationBilling } = await import("@/server/services/billing-reconciliation-service");

    const result = await reconcileOrganizationBilling({ organizationId: orgAId });
    expect(result.hasRemoteSubscription).toBe(false);
    expect(result.divergences).toEqual([{ field: "status", local: "ACTIVE", remote: "(not found)" }]);

    const events = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) =>
      auditEventRepository.list({ limit: 10 }, { organizationId: orgAId, action: "billing.reconciliation.divergence_detected" }, tx),
    );
    expect(events.items).toHaveLength(1);
  });

  it("a forged organizationId with no billing history at all is safe (no throw, just an empty result) — not an IDOR since billing.readPlatform is a platform-wide permission", async () => {
    const support = await makeMember(platformOrgId, "support_admin", "reconcile-forged-org@example.com");
    actAs(support.userId, support.membership);
    const { reconcileOrganizationBilling } = await import("@/server/services/billing-reconciliation-service");

    await expect(reconcileOrganizationBilling({ organizationId: "00000000-0000-0000-0000-000000000000" })).resolves.toMatchObject({ hasBillingAccount: false });
  });
});
