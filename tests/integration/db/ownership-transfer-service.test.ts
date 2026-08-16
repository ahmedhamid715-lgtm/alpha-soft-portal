import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";

/**
 * Ownership transfer (spec sections 20/21/46) — atomicity, escalation
 * protection, and the mandatory concurrent-transfer race test.
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

describe.skipIf(!isDatabaseConfigured)("ownership-transfer-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let orgBId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Transfer Org A", displayName: "Transfer Org A", slug: `transfer-org-a-${orgAId}` });
    orgIds.push(orgAId);
    orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "Transfer Org B", displayName: "Transfer Org B", slug: `transfer-org-b-${orgBId}` });
    orgIds.push(orgBId);

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

  it("the owner can transfer ownership to another active member — atomic, both sides update", async () => {
    const { transferOwnership } = await import("@/server/services/ownership-transfer-service");
    const owner = await makeMember(orgAId, "owner", "transfer-owner-1@example.com");
    const target = await makeMember(orgAId, "member", "transfer-target-1@example.com");
    actAs(owner.userId, owner.membership);

    await transferOwnership({ organizationId: orgAId, toMembershipId: target.membership.id });

    const oldOwnerMembership = await membershipRepository.findById(owner.membership.id);
    const newOwnerMembership = await membershipRepository.findById(target.membership.id);
    expect(oldOwnerMembership?.role).toBe("admin");
    expect(newOwnerMembership?.role).toBe("owner");

    // Exactly one owner in the org, always.
    const ownerCount = await db.organizationMembership.count({ where: { organizationId: orgAId, role: "owner", status: "ACTIVE" } });
    expect(ownerCount).toBe(1);
  });

  it("an ADMIN cannot transfer ownership — lacks ownership.transfer entirely (spec section 21)", async () => {
    const { transferOwnership } = await import("@/server/services/ownership-transfer-service");
    const owner = await makeMember(orgAId, "owner", "attacker-owner-1@example.com");
    const admin = await makeMember(orgAId, "admin", "attacker-admin-1@example.com");
    actAs(admin.userId, admin.membership);

    await expect(
      transferOwnership({ organizationId: orgAId, toMembershipId: owner.membership.id }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("a VIEWER cannot transfer ownership", async () => {
    const { transferOwnership } = await import("@/server/services/ownership-transfer-service");
    const owner = await makeMember(orgAId, "owner", "attacker-owner-2@example.com");
    const viewer = await makeMember(orgAId, "viewer", "attacker-viewer-1@example.com");
    actAs(viewer.userId, viewer.membership);

    await expect(
      transferOwnership({ organizationId: orgAId, toMembershipId: owner.membership.id }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("cross-tenant: Org B's owner cannot transfer ownership of Org A", async () => {
    const { transferOwnership } = await import("@/server/services/ownership-transfer-service");
    const ownerA = await makeMember(orgAId, "owner", "cross-owner-a@example.com");
    const ownerB = await makeMember(orgBId, "owner", "cross-owner-b@example.com");
    const targetA = await makeMember(orgAId, "member", "cross-target-a@example.com");
    actAs(ownerB.userId, ownerB.membership);

    await expect(
      transferOwnership({ organizationId: orgAId, toMembershipId: targetA.membership.id }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });

    // Org A's real owner is unaffected.
    const stillOwner = await membershipRepository.findById(ownerA.membership.id);
    expect(stillOwner?.role).toBe("owner");
  });

  it("a suspended member cannot become owner", async () => {
    const { transferOwnership } = await import("@/server/services/ownership-transfer-service");
    const owner = await makeMember(orgAId, "owner", "suspend-owner-1@example.com");
    const target = await makeMember(orgAId, "member", "suspend-target-1@example.com");
    await membershipRepository.updateStatus(target.membership.id, "SUSPENDED");
    actAs(owner.userId, owner.membership);

    await expect(
      transferOwnership({ organizationId: orgAId, toMembershipId: target.membership.id }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("cannot transfer ownership to a membership belonging to a different organization (forged toMembershipId)", async () => {
    const { transferOwnership } = await import("@/server/services/ownership-transfer-service");
    const ownerA = await makeMember(orgAId, "owner", "forge-owner-a@example.com");
    const memberB = await makeMember(orgBId, "member", "forge-member-b@example.com");
    actAs(ownerA.userId, ownerA.membership);

    await expect(
      transferOwnership({ organizationId: orgAId, toMembershipId: memberB.membership.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // --- Section 46: the mandatory ownership-transfer race test ------------

  it("two concurrent transfer attempts by the same owner never leave zero or two owners", async () => {
    const { transferOwnership } = await import("@/server/services/ownership-transfer-service");
    const owner = await makeMember(orgAId, "owner", "race-owner-2@example.com");
    const targetX = await makeMember(orgAId, "member", "race-target-x@example.com");
    const targetY = await makeMember(orgAId, "member", "race-target-y@example.com");
    actAs(owner.userId, owner.membership);

    const results = await Promise.allSettled([
      transferOwnership({ organizationId: orgAId, toMembershipId: targetX.membership.id }),
      transferOwnership({ organizationId: orgAId, toMembershipId: targetY.membership.id }),
    ]);

    // The row lock (SELECT ... FOR UPDATE on the organization) serializes
    // these — the second to run sees, post-lock, that `owner` (the
    // caller) is no longer the current owner and fails cleanly; it must
    // NOT silently succeed and create a second owner.
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const ownerCount = await db.organizationMembership.count({ where: { organizationId: orgAId, role: "owner", status: "ACTIVE" } });
    expect(ownerCount).toBe(1);

    // Exactly one of targetX/targetY actually became owner — never both, never neither.
    const [freshX, freshY] = await Promise.all([
      membershipRepository.findById(targetX.membership.id),
      membershipRepository.findById(targetY.membership.id),
    ]);
    const newOwners = [freshX, freshY].filter((m) => m?.role === "owner");
    expect(newOwners).toHaveLength(1);
  });
});
