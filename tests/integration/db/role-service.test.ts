import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";

/**
 * The core adversarial test suite (spec sections 25/36/37) — every
 * privilege-escalation and cross-tenant attempt the audit explicitly
 * requires, run against `role-service.ts`'s real functions with real
 * Postgres data. Identity is mocked the same way
 * `authorization-engine.test.ts` does (see that file's top comment);
 * every `Role`/`OrganizationMembership`/`Organization` row involved is
 * real.
 */

let mockUser: { id: string } | null = null;
let mockMembershipsByOrg = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (organizationId) return mockMembershipsByOrg.get(organizationId) ?? null;
    // "sole membership" fallback, mirroring Module 04's real behavior.
    return mockMembershipsByOrg.size === 1 ? [...mockMembershipsByOrg.values()][0] : null;
  }),
}));

describe.skipIf(!isDatabaseConfigured)("role-service (database integration — adversarial matrix)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let orgBId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Org A", displayName: "Org A", slug: `org-a-${orgAId}` });
    orgIds.push(orgAId);

    orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "Org B", displayName: "Org B", slug: `org-b-${orgBId}` });
    orgIds.push(orgBId);

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));
  });

  afterEach(async () => {
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    userIds.length = 0;
    orgIds.length = 0;
    vi.restoreAllMocks();
  });

  /** Creates a real user + membership in `organizationId` holding `roleKey`, and returns the membership row. */
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

  // --- Section 25/37: privilege escalation ------------------------------

  it("CUSTOMER cannot assign themselves (or anyone) a privileged role", async () => {
    const { assignRole } = await import("@/server/services/role-service");
    const customer = await makeMember(orgAId, "customer", "esc-customer@example.com");
    const admin = await makeMember(orgAId, "admin", "esc-target-1@example.com");

    actAs(customer.userId, customer.membership);
    await expect(
      assignRole({ membershipId: admin.membership.id, roleId: roleByKey.owner.id }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("MEMBER cannot promote themselves to OWNER", async () => {
    const { assignRole } = await import("@/server/services/role-service");
    const member = await makeMember(orgAId, "member", "esc-member@example.com");

    actAs(member.userId, member.membership);
    await expect(
      assignRole({ membershipId: member.membership.id, roleId: roleByKey.owner.id }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("VIEWER cannot promote another member to ADMIN", async () => {
    const { assignRole } = await import("@/server/services/role-service");
    const viewer = await makeMember(orgAId, "viewer", "esc-viewer@example.com");
    const target = await makeMember(orgAId, "member", "esc-target-2@example.com");

    actAs(viewer.userId, viewer.membership);
    await expect(
      assignRole({ membershipId: target.membership.id, roleId: roleByKey.admin.id }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("SUPPORT_AGENT cannot escalate to PLATFORM_ADMIN", async () => {
    const platformOrg = await organizationRepository.findPlatformOrganization();
    const { assignRole } = await import("@/server/services/role-service");
    const agent = await makeMember(platformOrg!.id, "support_agent", "esc-agent@example.com");

    actAs(agent.userId, agent.membership);
    await expect(
      assignRole({ membershipId: agent.membership.id, roleId: roleByKey.platform_admin.id }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("an ORGANIZATION_ADMIN of one org cannot reach into the platform organization at all", async () => {
    const platformOrg = await organizationRepository.findPlatformOrganization();
    const { assignRole } = await import("@/server/services/role-service");
    const orgAdmin = await makeMember(orgAId, "admin", "esc-orgadmin@example.com");
    const platformAgent = await makeMember(platformOrg!.id, "support_agent", "esc-agent-2@example.com");

    // orgAdmin has no membership in the platform org — requirePermission("members.update", platformOrgId) must resolve no context there.
    actAs(orgAdmin.userId, orgAdmin.membership);
    await expect(
      assignRole({ membershipId: platformAgent.membership.id, roleId: roleByKey.platform_admin.id }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("a PLATFORM-scope role can never be assigned inside a regular organization, even by that org's own owner", async () => {
    const { assignRole } = await import("@/server/services/role-service");
    const owner = await makeMember(orgAId, "owner", "esc-owner-scope@example.com");
    const target = await makeMember(orgAId, "member", "esc-target-3@example.com");

    actAs(owner.userId, owner.membership);
    await expect(
      assignRole({ membershipId: target.membership.id, roleId: roleByKey.platform_admin.id }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  // --- Section 36: cross-tenant -------------------------------------

  it("Org A's owner cannot assign a role to a membership belonging to Org B", async () => {
    const { assignRole } = await import("@/server/services/role-service");
    const ownerA = await makeMember(orgAId, "owner", "xtenant-owner-a@example.com");
    const memberB = await makeMember(orgBId, "member", "xtenant-member-b@example.com");

    actAs(ownerA.userId, ownerA.membership);
    await expect(
      assignRole({ membershipId: memberB.membership.id, roleId: roleByKey.admin.id }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("Org A's owner cannot delete or read Org B's custom role via createCustomRole/deleteRole's organization check", async () => {
    const { createCustomRole, deleteRole } = await import("@/server/services/role-service");
    const ownerA = await makeMember(orgAId, "owner", "xtenant-owner-a2@example.com");
    const ownerB = await makeMember(orgBId, "owner", "xtenant-owner-b@example.com");

    actAs(ownerB.userId, ownerB.membership);
    const customRoleB = await createCustomRole({ organizationId: orgBId, key: "b-only-role", name: "B Only Role", permissions: [] });

    actAs(ownerA.userId, ownerA.membership);
    // Org A's owner has roles.delete in THEIR org, but the target role belongs to Org B.
    await expect(
      deleteRole({ roleId: customRoleB.id, organizationId: orgAId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // --- Section 26/27: role deletion + last-owner protection -------------

  it("a system role can never be deleted, even by a caller who holds roles.delete — 404, not 403 (spec section 31 enumeration avoidance)", async () => {
    // A system role's `organizationId` is always null, so it never
    // matches a caller's org-scoped request — the lookup itself fails
    // before `assertNotSystemRole()`'s explicit check would even run,
    // the same "don't confirm a protected thing exists" shape section 31
    // asks for elsewhere. `assertNotSystemRole()` stays in place as
    // defense-in-depth for any future code path that looks a role up by
    // id alone.
    const { deleteRole } = await import("@/server/services/role-service");
    const owner = await makeMember(orgAId, "owner", "sysrole-delete@example.com");
    actAs(owner.userId, owner.membership);

    await expect(
      deleteRole({ roleId: roleByKey.member.id, organizationId: orgAId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a system role can never be modified at runtime, even by a caller who holds roles.update — 404, same reasoning", async () => {
    const { updateRole } = await import("@/server/services/role-service");
    const owner = await makeMember(orgAId, "owner", "sysrole-update@example.com");
    actAs(owner.userId, owner.membership);

    await expect(
      updateRole({ roleId: roleByKey.member.id, organizationId: orgAId, name: "Hacked Name" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a custom role still assigned to a member cannot be deleted (spec section 26)", async () => {
    const { createCustomRole, deleteRole } = await import("@/server/services/role-service");
    const { assignRole } = await import("@/server/services/role-service");
    const owner = await makeMember(orgAId, "owner", "role-del-safety@example.com");
    const target = await makeMember(orgAId, "member", "role-del-target@example.com");

    actAs(owner.userId, owner.membership);
    const customRole = await createCustomRole({ organizationId: orgAId, key: "billing-lead", name: "Billing Lead", permissions: ["billing.read"] });
    await assignRole({ membershipId: target.membership.id, roleId: customRole.id });

    await expect(deleteRole({ roleId: customRole.id, organizationId: orgAId })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("the last owner cannot be demoted", async () => {
    const { assignRole } = await import("@/server/services/role-service");
    const owner = await makeMember(orgAId, "owner", "last-owner-demote@example.com");
    actAs(owner.userId, owner.membership);

    await expect(
      assignRole({ membershipId: owner.membership.id, roleId: roleByKey.admin.id }),
    ).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "last_owner" } });
  });

  it("demoting an owner succeeds once a second owner exists", async () => {
    const { assignRole } = await import("@/server/services/role-service");
    const owner1 = await makeMember(orgAId, "owner", "two-owner-1@example.com");
    const owner2 = await makeMember(orgAId, "owner", "two-owner-2@example.com");

    actAs(owner1.userId, owner1.membership);
    await expect(assignRole({ membershipId: owner1.membership.id, roleId: roleByKey.admin.id })).resolves.toBeUndefined();

    const updated = await membershipRepository.findById(owner1.membership.id);
    expect(updated?.role).toBe("admin");
    void owner2;
  });

  it("the last owner cannot be removed from the organization", async () => {
    const { removeMember } = await import("@/server/services/membership-service");
    const owner = await makeMember(orgAId, "owner", "last-owner-remove@example.com");
    actAs(owner.userId, owner.membership);

    await expect(removeMember({ membershipId: owner.membership.id })).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "last_owner" },
    });
  });

  it("the last owner cannot be suspended", async () => {
    const { updateMemberStatus } = await import("@/server/services/membership-service");
    const owner = await makeMember(orgAId, "owner", "last-owner-suspend@example.com");
    actAs(owner.userId, owner.membership);

    await expect(
      updateMemberStatus({ membershipId: owner.membership.id, status: "SUSPENDED" }),
    ).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "last_owner" } });
  });

  // --- Legitimate paths still work ---------------------------------------

  it("an ORGANIZATION_OWNER can legitimately promote a member to admin", async () => {
    const { assignRole } = await import("@/server/services/role-service");
    const owner = await makeMember(orgAId, "owner", "legit-owner@example.com");
    const target = await makeMember(orgAId, "member", "legit-target@example.com");

    actAs(owner.userId, owner.membership);
    await expect(assignRole({ membershipId: target.membership.id, roleId: roleByKey.admin.id })).resolves.toBeUndefined();

    const updated = await membershipRepository.findById(target.membership.id);
    expect(updated?.role).toBe("admin");
    expect(updated?.roleId).toBe(roleByKey.admin.id);
  });

  it("a PLATFORM_OWNER can create an organization-scope custom role within the platform organization itself (self-administration, not escalation)", async () => {
    // `roles.create` is a single permission key shared by both scopes
    // (see permissions.ts's "roles" entries) — what differs is which
    // *context* resolves it. Here `createCustomRole` resolves the
    // platform org AS an ordinary organization context, and platform_owner
    // legitimately holds `roles.create` there too (PLATFORM_FULL grants
    // it) — this is the platform owner administering their own
    // organization's custom roles, the same capability any org owner has
    // over their own org, not a scope violation.
    const platformOrg = await organizationRepository.findPlatformOrganization();
    const { createCustomRole, deleteRole } = await import("@/server/services/role-service");
    const owner = await makeMember(platformOrg!.id, "platform_owner", "legit-platform-owner@example.com");

    actAs(owner.userId, owner.membership);
    const created = await createCustomRole({
      organizationId: platformOrg!.id,
      key: "platform-internal-role",
      name: "Platform Internal Role",
      permissions: [],
    });
    expect(created.organizationId).toBe(platformOrg!.id);

    await expect(deleteRole({ roleId: created.id, organizationId: platformOrg!.id })).resolves.toBeUndefined();
  });
});
