import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";

/**
 * `billing-account-service.ts` (Module 13) — get-or-create idempotency,
 * permission gating (`billing.read`/`billing.refund`), and the owner-
 * only `updateBillingAccountStatus()` platform action. The Stripe
 * provider is mocked (`stripeBillingProvider.createCustomer`) — this
 * file proves Alpha OS's OWN authorization/persistence logic, not
 * Stripe's API; provider mapping is covered by `mapper.test.ts`, and
 * end-to-end webhook reconciliation by `billing-webhook-service.test.ts`.
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

vi.mock("@/lib/billing/provider/stripe/provider", () => ({
  stripeBillingProvider: {
    createCustomer: vi.fn(async () => ({ providerCustomerId: `cus_test_${generateId()}` })),
    createCheckoutSession: vi.fn(),
    createBillingPortalSession: vi.fn(),
    cancelSubscription: vi.fn(),
    resumeSubscription: vi.fn(),
    issueRefund: vi.fn(),
  },
}));

describe.skipIf(!isDatabaseConfigured)("billing-account-service (database integration)", () => {
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
    await organizationRepository.create({ id: orgAId, name: "Billing Org A", displayName: "Billing Org A", slug: `billing-org-a-${orgAId}` });
    orgIds.push(orgAId);
    orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "Billing Org B", displayName: "Billing Org B", slug: `billing-org-b-${orgBId}` });
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

  it("getOrCreateBillingAccount is idempotent — a second call returns the SAME row, never a duplicate", async () => {
    const owner = await makeMember(orgAId, "owner", "idempotent-owner@example.com");
    const { getOrCreateBillingAccount } = await import("@/server/services/billing-account-service");

    const first = await getOrCreateBillingAccount(orgAId, owner.userId, false);
    const second = await getOrCreateBillingAccount(orgAId, owner.userId, false);
    expect(second.id).toBe(first.id);

    const rows = await db.billingAccount.findMany({ where: { organizationId: orgAId } });
    expect(rows).toHaveLength(1);
  });

  it("getBillingAccount: owner and admin can read (billing.read via ORGANIZATION_FULL); member cannot", async () => {
    const owner = await makeMember(orgAId, "owner", "read-owner@example.com");
    const { getOrCreateBillingAccount, getBillingAccount } = await import("@/server/services/billing-account-service");
    await getOrCreateBillingAccount(orgAId, owner.userId, false);

    const admin = await makeMember(orgAId, "admin", "read-admin@example.com");
    actAs(admin.userId, admin.membership);
    await expect(getBillingAccount({ organizationId: orgAId })).resolves.not.toBeNull();

    const member = await makeMember(orgAId, "member", "read-member@example.com");
    actAs(member.userId, member.membership);
    await expect(getBillingAccount({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("Org B's owner cannot read Org A's billing account (cross-tenant IDOR via forged organizationId)", async () => {
    const ownerA = await makeMember(orgAId, "owner", "cross-owner-a@example.com");
    const { getOrCreateBillingAccount, getBillingAccount } = await import("@/server/services/billing-account-service");
    await getOrCreateBillingAccount(orgAId, ownerA.userId, false);

    const ownerB = await makeMember(orgBId, "owner", "cross-owner-b@example.com");
    actAs(ownerB.userId, ownerB.membership);
    await expect(getBillingAccount({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("getBillingAccount returns null (not a 404) when the organization has no billing account yet — a normal state", async () => {
    const owner = await makeMember(orgAId, "owner", "no-account-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { getBillingAccount } = await import("@/server/services/billing-account-service");
    await expect(getBillingAccount({ organizationId: orgAId })).resolves.toBeNull();
  });

  it("updateBillingAccountStatus requires billing.refund (platform_owner only) — platform_admin is denied", async () => {
    const owner = await makeMember(orgAId, "owner", "suspend-target-owner@example.com");
    const { getOrCreateBillingAccount, updateBillingAccountStatus } = await import("@/server/services/billing-account-service");
    await getOrCreateBillingAccount(orgAId, owner.userId, false);

    const platformAdmin = await makeMember(platformOrgId, "platform_admin", "suspend-platform-admin@example.com");
    actAs(platformAdmin.userId, platformAdmin.membership);
    await expect(updateBillingAccountStatus({ organizationId: orgAId, status: "SUSPENDED" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });

    const platformOwner = await makeMember(platformOrgId, "platform_owner", "suspend-platform-owner@example.com");
    actAs(platformOwner.userId, platformOwner.membership);
    const updated = await updateBillingAccountStatus({ organizationId: orgAId, status: "SUSPENDED" });
    expect(updated.status).toBe("SUSPENDED");
  });

  it("support_admin (holds billing.readPlatform) cannot suspend a billing account — read visibility is not write access", async () => {
    const owner = await makeMember(orgAId, "owner", "support-suspend-owner@example.com");
    const { getOrCreateBillingAccount, updateBillingAccountStatus } = await import("@/server/services/billing-account-service");
    await getOrCreateBillingAccount(orgAId, owner.userId, false);

    const supportAdmin = await makeMember(platformOrgId, "support_admin", "support-suspend-admin@example.com");
    actAs(supportAdmin.userId, supportAdmin.membership);
    await expect(updateBillingAccountStatus({ organizationId: orgAId, status: "SUSPENDED" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("an unauthenticated caller is denied (401, not 403)", async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();
    const { getBillingAccount } = await import("@/server/services/billing-account-service");
    await expect(getBillingAccount({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR" });
  });
});
