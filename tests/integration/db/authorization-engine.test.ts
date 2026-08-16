import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";

/**
 * Real-database coverage of `context.ts`/`authorize.ts` — the
 * authorization engine itself, section 35's "AUTHENTICATION /
 * unauthenticated user / authenticated user" and PLATFORM/ORGANIZATION
 * resolution cases. Module 04's own session (`getCurrentUser`/
 * `getCurrentMembership`) is mocked — the same technique
 * `session-guard.test.ts` already established — so these tests exercise
 * a controlled identity against REAL `Role`/`Permission`/
 * `RolePermission`/`OrganizationMembership` rows, not a fake permission
 * set. This is "direct database-backed service call" testing (spec
 * section 36), not an HTTP/browser test.
 */

let mockUser: { id: string; status?: string } | null = null;
let mockMembership: { organizationId: string; userId: string; roleId: string | null; status: string } | null = null;

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (!mockMembership) return null;
    if (organizationId && mockMembership.organizationId !== organizationId) return null;
    return mockMembership;
  }),
}));

describe.skipIf(!isDatabaseConfigured)("Authorization engine (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];

  beforeEach(() => {
    mockUser = null;
    mockMembership = null;
  });

  afterEach(async () => {
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    userIds.length = 0;
    orgIds.length = 0;
    vi.restoreAllMocks();
  });

  async function makeOrgWithOwnerRole(isPlatform: boolean) {
    const orgId = generateId();
    await organizationRepository.create({ id: orgId, name: "Test Org", displayName: "Test Org", slug: `test-org-${orgId}` });
    if (isPlatform) await db.organization.update({ where: { id: orgId }, data: { isPlatform: true } });
    orgIds.push(orgId);
    return orgId;
  }

  it("resolveOrganizationContext returns empty permissions for an unauthenticated caller", async () => {
    const { resolveOrganizationContext } = await import("@/lib/authorization/context");
    const context = await resolveOrganizationContext();
    expect(context.user).toBeNull();
    expect(context.permissions.size).toBe(0);
  });

  it("resolveOrganizationContext resolves real permissions from a real Role/RolePermission chain", async () => {
    const orgId = await makeOrgWithOwnerRole(false);
    const userId = generateId();
    await userRepository.create({ id: userId, email: `authz-${userId}@example.com`, name: "Authz Test" });
    userIds.push(userId);

    const ownerRole = await roleRepository.findSystemRoleByKey("owner");
    expect(ownerRole).not.toBeNull();

    const membership = await membershipRepository.create({ id: generateId(), organizationId: orgId, userId, role: "owner" });
    await membershipRepository.updateRoleAssignment(membership.id, { role: "owner", roleId: ownerRole!.id });

    mockUser = { id: userId };
    mockMembership = { organizationId: orgId, userId, roleId: ownerRole!.id, status: "ACTIVE" };

    const { resolveOrganizationContext } = await import("@/lib/authorization/context");
    const context = await resolveOrganizationContext(orgId);
    expect(context.permissions.has("members.invite")).toBe(true);
    expect(context.permissions.has("billing.manage")).toBe(true); // owner-only permission
    expect(context.isPlatformStaff).toBe(false);
  });

  it("a SUSPENDED organization resolves zero permissions for its members, even with an ACTIVE membership and a valid role — regression test for a real bug this module's own E2E suite found", async () => {
    const orgId = await makeOrgWithOwnerRole(false);
    const userId = generateId();
    await userRepository.create({ id: userId, email: `suspended-org-${userId}@example.com`, name: "Suspended Org Test" });
    userIds.push(userId);

    const ownerRole = await roleRepository.findSystemRoleByKey("owner");
    const membership = await membershipRepository.create({ id: generateId(), organizationId: orgId, userId, role: "owner" });
    await membershipRepository.updateRoleAssignment(membership.id, { role: "owner", roleId: ownerRole!.id });
    await db.organization.update({ where: { id: orgId }, data: { status: "SUSPENDED" } });

    mockUser = { id: userId };
    mockMembership = { organizationId: orgId, userId, roleId: ownerRole!.id, status: "ACTIVE" };

    const { resolveOrganizationContext } = await import("@/lib/authorization/context");
    const context = await resolveOrganizationContext(orgId);
    expect(context.permissions.size).toBe(0);
    expect(context.membership).toBeNull();
  });

  it("an ARCHIVED organization resolves zero permissions for its members", async () => {
    const orgId = await makeOrgWithOwnerRole(false);
    const userId = generateId();
    await userRepository.create({ id: userId, email: `archived-org-${userId}@example.com`, name: "Archived Org Test" });
    userIds.push(userId);

    const memberRole = await roleRepository.findSystemRoleByKey("member");
    const membership = await membershipRepository.create({ id: generateId(), organizationId: orgId, userId, role: "member" });
    await membershipRepository.updateRoleAssignment(membership.id, { role: "member", roleId: memberRole!.id });
    await db.organization.update({ where: { id: orgId }, data: { status: "ARCHIVED", archivedAt: new Date() } });

    mockUser = { id: userId };
    mockMembership = { organizationId: orgId, userId, roleId: memberRole!.id, status: "ACTIVE" };

    const { resolveOrganizationContext } = await import("@/lib/authorization/context");
    const context = await resolveOrganizationContext(orgId);
    expect(context.permissions.size).toBe(0);
  });

  it("a SUSPENDED membership resolves zero permissions even with a valid roleId", async () => {
    const orgId = await makeOrgWithOwnerRole(false);
    const userId = generateId();
    await userRepository.create({ id: userId, email: `suspended-${userId}@example.com`, name: "Suspended Test" });
    userIds.push(userId);

    const ownerRole = await roleRepository.findSystemRoleByKey("owner");
    const membership = await membershipRepository.create({ id: generateId(), organizationId: orgId, userId, role: "owner" });
    await membershipRepository.updateRoleAssignment(membership.id, { role: "owner", roleId: ownerRole!.id });
    await membershipRepository.updateStatus(membership.id, "SUSPENDED");

    mockUser = { id: userId };
    mockMembership = { organizationId: orgId, userId, roleId: ownerRole!.id, status: "SUSPENDED" };

    const { resolveOrganizationContext } = await import("@/lib/authorization/context");
    const context = await resolveOrganizationContext(orgId);
    expect(context.permissions.size).toBe(0);
  });

  it("resolvePlatformContext finds platform staff regardless of other organization memberships", async () => {
    // Deliberately reuses the ONE real seeded platform organization
    // rather than creating a second `isPlatform = true` row — see
    // `organizations_single_platform_org` (schema.prisma's `isPlatform`
    // comment): a second such row is now a database constraint
    // violation, found by an earlier version of this exact test.
    const platformOrg = await organizationRepository.findPlatformOrganization();
    expect(platformOrg).not.toBeNull();
    const platformOrgId = platformOrg!.id;
    const userId = generateId();
    await userRepository.create({ id: userId, email: `platform-${userId}@example.com`, name: "Platform Test" });
    userIds.push(userId);

    const platformAdminRole = await roleRepository.findSystemRoleByKey("platform_admin");
    const membership = await membershipRepository.create({
      id: generateId(),
      organizationId: platformOrgId,
      userId,
      role: "platform_admin",
    });
    await membershipRepository.updateRoleAssignment(membership.id, { role: "platform_admin", roleId: platformAdminRole!.id });

    mockUser = { id: userId };
    mockMembership = { organizationId: platformOrgId, userId, roleId: platformAdminRole!.id, status: "ACTIVE" };

    const { resolvePlatformContext } = await import("@/lib/authorization/context");
    const context = await resolvePlatformContext();
    expect(context.isPlatformStaff).toBe(true);
    expect(context.permissions.has("users.read")).toBe(true);
    expect(context.permissions.has("billing.manage")).toBe(false); // platform_admin, not platform_owner
  });

  it("requirePermission throws AuthenticationError with no session, PermissionDeniedError with an insufficient one", async () => {
    const { requirePermission } = await import("@/lib/authorization/authorize");

    mockUser = null;
    await expect(requirePermission("members.read")).rejects.toMatchObject({ name: "AuthenticationError" });

    const orgId = await makeOrgWithOwnerRole(false);
    const userId = generateId();
    await userRepository.create({ id: userId, email: `viewer-${userId}@example.com`, name: "Viewer Test" });
    userIds.push(userId);
    const viewerRole = await roleRepository.findSystemRoleByKey("viewer");
    const membership = await membershipRepository.create({ id: generateId(), organizationId: orgId, userId, role: "viewer" });
    await membershipRepository.updateRoleAssignment(membership.id, { role: "viewer", roleId: viewerRole!.id });

    mockUser = { id: userId };
    mockMembership = { organizationId: orgId, userId, roleId: viewerRole!.id, status: "ACTIVE" };

    await expect(requirePermission("members.invite", orgId)).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    await expect(requirePermission("tickets.read", orgId)).resolves.toBeDefined();
  });
});
