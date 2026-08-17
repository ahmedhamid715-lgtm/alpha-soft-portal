import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { onboardingRepository } from "@/server/repositories/onboarding-repository";

/**
 * `organization-management-service.ts` (Module 07) — creation atomicity,
 * profile updates, lifecycle transitions, and platform listing. Escalation
 * / cross-tenant / IDOR coverage complementary to `invitation-service.test.ts`
 * and `ownership-transfer-service.test.ts`, not a repeat of them — spec
 * sections 28–35, 47–49.
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

describe.skipIf(!isDatabaseConfigured)("organization-management-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  const platformMembershipIds: string[] = [];
  let orgAId: string;
  let orgBId: string;
  let platformOrgId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "OrgMgmt Org A", displayName: "OrgMgmt Org A", slug: `orgmgmt-org-a-${orgAId}` });
    orgIds.push(orgAId);
    orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "OrgMgmt Org B", displayName: "OrgMgmt Org B", slug: `orgmgmt-org-b-${orgBId}` });
    orgIds.push(orgBId);

    // Reuse the ONE real seeded platform organization — a second
    // `isPlatform = true` row is a database constraint violation (see
    // `organizations_single_platform_org`; same pattern as
    // authorization-engine.test.ts).
    const platformOrg = await organizationRepository.findPlatformOrganization();
    expect(platformOrg).not.toBeNull();
    platformOrgId = platformOrg!.id;

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));
  });

  afterEach(async () => {
    if (platformMembershipIds.length) await db.organizationMembership.deleteMany({ where: { id: { in: platformMembershipIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    orgIds.length = 0;
    platformMembershipIds.length = 0;
    vi.restoreAllMocks();
  });

  async function makeMember(organizationId: string, roleKey: string, email: string) {
    const userId = generateId();
    await userRepository.create({ id: userId, email, name: email });
    userIds.push(userId);
    const role = roleByKey[roleKey];
    const membership = await membershipRepository.create({ id: generateId(), organizationId, userId, role: roleKey });
    await membershipRepository.updateRoleAssignment(membership.id, { role: roleKey, roleId: role.id });
    if (organizationId === platformOrgId) platformMembershipIds.push(membership.id);
    return { userId, membership: { ...membership, roleId: role.id } };
  }

  function actAs(userId: string, membership: { organizationId: string; userId: string; roleId: string | null; status: string }) {
    mockUser = { id: userId };
    mockMembershipsByOrg = new Map([[membership.organizationId, membership]]);
  }

  // --- createOrganization: authorization + atomicity ----------------------

  it("platform_admin creates an organization: org + owner membership + onboarding all exist atomically", async () => {
    const { createOrganization } = await import("@/server/services/organization-management-service");
    const admin = await makeMember(platformOrgId, "platform_admin", "org-create-admin@example.com");
    actAs(admin.userId, admin.membership);

    const slug = `new-org-${generateId()}`;
    const result = await createOrganization({
      organization: { name: "Brand New Org", displayName: "Brand New Org", slug },
      owner: { email: "new-org-owner@example.com", name: "New Org Owner" },
    });
    orgIds.push(result.organization.id);
    userIds.push(result.membership.userId);

    expect(result.organization.slug).toBe(slug);
    expect(result.membership.role).toBe("owner");
    expect(result.membership.roleId).not.toBeNull();

    const onboarding = await onboardingRepository.findByOrganizationId(result.organization.id);
    expect(onboarding).not.toBeNull();
    expect(onboarding?.currentStep).toBe("profile");

    const membership = await membershipRepository.findByOrganizationAndUser(result.organization.id, result.membership.userId);
    expect(membership?.role).toBe("owner");
  });

  it("creating an organization with a slug that already exists is rejected (CONFLICT), nothing partially created", async () => {
    const { createOrganization } = await import("@/server/services/organization-management-service");
    const admin = await makeMember(platformOrgId, "platform_admin", "org-create-dup-admin@example.com");
    actAs(admin.userId, admin.membership);

    // Email is unique to THIS test (not the literal "dup-owner@example.com"
    // reused by invitation-service.test.ts's own fixture) — Vitest runs
    // integration test files concurrently against the same real Postgres
    // database, so a shared literal email is a genuine cross-file race:
    // this test's `findByEmail` below could observe the other file's row,
    // not a stray created here, and fail non-deterministically.
    const ownerEmail = `dup-owner-${orgAId}@example.com`;
    await expect(
      createOrganization({
        organization: { name: "Dup", displayName: "Dup", slug: `orgmgmt-org-a-${orgAId}` },
        owner: { email: ownerEmail, name: "Dup Owner" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // No stray user created for the rejected attempt.
    const stray = await userRepository.findByEmail(ownerEmail);
    expect(stray).toBeNull();
  });

  it("a customer organization's OWNER cannot create a new organization — organizations.create is PLATFORM-scope only (spec section 28)", async () => {
    const { createOrganization } = await import("@/server/services/organization-management-service");
    const owner = await makeMember(orgAId, "owner", "not-platform-owner@example.com");
    actAs(owner.userId, owner.membership);

    await expect(
      createOrganization({
        organization: { name: "Should Fail", displayName: "Should Fail", slug: `should-fail-${generateId()}` },
        owner: { email: "should-fail-owner@example.com", name: "Should Fail Owner" },
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("support_admin (has organizations.read but not organizations.create) is denied", async () => {
    const { createOrganization } = await import("@/server/services/organization-management-service");
    const support = await makeMember(platformOrgId, "support_admin", "support-admin-create@example.com");
    actAs(support.userId, support.membership);

    await expect(
      createOrganization({
        organization: { name: "Support Fail", displayName: "Support Fail", slug: `support-fail-${generateId()}` },
        owner: { email: "support-fail-owner@example.com", name: "Support Fail Owner" },
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("an unauthenticated caller cannot create an organization (401, not 403)", async () => {
    const { createOrganization } = await import("@/server/services/organization-management-service");
    mockUser = null;
    mockMembershipsByOrg = new Map();

    await expect(
      createOrganization({
        organization: { name: "Anon", displayName: "Anon", slug: `anon-${generateId()}` },
        owner: { email: "anon-owner@example.com", name: "Anon Owner" },
      }),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR" });
  });

  // --- updateOrganizationProfile: escalation + cross-tenant ----------------

  it("an org owner can update their organization's profile", async () => {
    const { updateOrganizationProfile } = await import("@/server/services/organization-management-service");
    const owner = await makeMember(orgAId, "owner", "profile-owner@example.com");
    actAs(owner.userId, owner.membership);

    const updated = await updateOrganizationProfile({ organizationId: orgAId, displayName: "Renamed Org A", industry: "SEO" });
    expect(updated.displayName).toBe("Renamed Org A");
    expect(updated.industry).toBe("SEO");
  });

  it("a MEMBER cannot update the organization profile (escalation)", async () => {
    const { updateOrganizationProfile } = await import("@/server/services/organization-management-service");
    const member = await makeMember(orgAId, "member", "profile-member@example.com");
    actAs(member.userId, member.membership);

    await expect(
      updateOrganizationProfile({ organizationId: orgAId, displayName: "Hacked Name" }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });

    const stillOrgA = await organizationRepository.findById(orgAId);
    expect(stillOrgA?.displayName).toBe("OrgMgmt Org A");
  });

  it("a VIEWER cannot update the organization profile (escalation)", async () => {
    const { updateOrganizationProfile } = await import("@/server/services/organization-management-service");
    const viewer = await makeMember(orgAId, "viewer", "profile-viewer@example.com");
    actAs(viewer.userId, viewer.membership);

    await expect(
      updateOrganizationProfile({ organizationId: orgAId, displayName: "Hacked Name 2" }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("Org B's admin cannot update Org A's profile (cross-tenant IDOR via forged organizationId)", async () => {
    const { updateOrganizationProfile } = await import("@/server/services/organization-management-service");
    const adminB = await makeMember(orgBId, "admin", "cross-admin-b@example.com");
    actAs(adminB.userId, adminB.membership);

    await expect(
      updateOrganizationProfile({ organizationId: orgAId, displayName: "Cross-Tenant Hack" }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });

    const stillOrgA = await organizationRepository.findById(orgAId);
    expect(stillOrgA?.displayName).toBe("OrgMgmt Org A");
  });

  it("updating to a slug already used by another organization is rejected", async () => {
    const { updateOrganizationProfile } = await import("@/server/services/organization-management-service");
    const owner = await makeMember(orgAId, "owner", "slug-owner@example.com");
    actAs(owner.userId, owner.membership);

    const orgB = await organizationRepository.findById(orgBId);
    await expect(
      updateOrganizationProfile({ organizationId: orgAId, slug: orgB!.slug }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // --- Lifecycle: suspend / reactivate / archive ---------------------------

  it("an owner can suspend their own organization, but reactivation requires platform staff (spec section 23)", async () => {
    const { suspendOrganization, reactivateOrganization } = await import("@/server/services/organization-management-service");
    const owner = await makeMember(orgAId, "owner", "lifecycle-owner@example.com");
    actAs(owner.userId, owner.membership);

    const suspended = await suspendOrganization({ organizationId: orgAId });
    expect(suspended.status).toBe("SUSPENDED");

    // The now-suspended org's own owner has lost `organizations.update`
    // entirely (spec section 21 — resolveOrganizationContext zeroes
    // permissions for a non-ACTIVE organization) and was never granted
    // `organizations.reactivate` (PLATFORM-scope) in the first place —
    // an organization cannot un-suspend itself.
    await expect(reactivateOrganization({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });

    const platformAdmin = await makeMember(platformOrgId, "platform_admin", "lifecycle-platform-admin@example.com");
    actAs(platformAdmin.userId, platformAdmin.membership);
    const reactivated = await reactivateOrganization({ organizationId: orgAId });
    expect(reactivated.status).toBe("ACTIVE");
    expect(reactivated.archivedAt).toBeNull();
  });

  it("an admin can archive an organization", async () => {
    const { archiveOrganization } = await import("@/server/services/organization-management-service");
    const admin = await makeMember(orgAId, "admin", "archive-admin@example.com");
    actAs(admin.userId, admin.membership);

    const archived = await archiveOrganization({ organizationId: orgAId });
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.archivedAt).not.toBeNull();
  });

  it("a MEMBER cannot suspend, reactivate, or archive the organization (escalation)", async () => {
    const svc = await import("@/server/services/organization-management-service");
    const member = await makeMember(orgAId, "member", "lifecycle-member@example.com");
    actAs(member.userId, member.membership);

    await expect(svc.suspendOrganization({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    await expect(svc.reactivateOrganization({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    await expect(svc.archiveOrganization({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });

    const stillActive = await organizationRepository.findById(orgAId);
    expect(stillActive?.status).toBe("ACTIVE");
  });

  it("Org B's owner cannot suspend Org A (cross-tenant IDOR via forged organizationId)", async () => {
    const { suspendOrganization } = await import("@/server/services/organization-management-service");
    const ownerB = await makeMember(orgBId, "owner", "cross-suspend-owner-b@example.com");
    actAs(ownerB.userId, ownerB.membership);

    await expect(suspendOrganization({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });

    const stillActive = await organizationRepository.findById(orgAId);
    expect(stillActive?.status).toBe("ACTIVE");
  });

  // --- listOrganizationsForPlatform: PLATFORM-scope only, never a tenant query ---

  it("platform_admin can list organizations platform-wide", async () => {
    const { listOrganizationsForPlatform } = await import("@/server/services/organization-management-service");
    const admin = await makeMember(platformOrgId, "platform_admin", "list-admin@example.com");
    actAs(admin.userId, admin.membership);

    const result = await listOrganizationsForPlatform({ page: 1, limit: 10 });
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("a customer organization's owner cannot list organizations platform-wide", async () => {
    const { listOrganizationsForPlatform } = await import("@/server/services/organization-management-service");
    const owner = await makeMember(orgAId, "owner", "list-owner-a@example.com");
    actAs(owner.userId, owner.membership);

    await expect(listOrganizationsForPlatform({ page: 1, limit: 10 })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });
});
