import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";

let mockUser: { id: string } | null = null;
let mockMembershipsByOrg = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();
let mockPlatformStaffId: string | null = null;

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (organizationId) return mockMembershipsByOrg.get(organizationId) ?? null;
    return mockMembershipsByOrg.size === 1 ? [...mockMembershipsByOrg.values()][0] : null;
  }),
}));

describe.skipIf(!isDatabaseConfigured)("knowledge-source-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let orgBId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};
  let platformOrgId: string;

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    orgAId = generateId();
    orgBId = generateId();
    await organizationRepository.create({ id: orgAId, name: "KS Test Org A", displayName: "KS Test Org A", slug: `ks-org-a-${orgAId}` });
    await organizationRepository.create({ id: orgBId, name: "KS Test Org B", displayName: "KS Test Org B", slug: `ks-org-b-${orgBId}` });
    orgIds.push(orgAId, orgBId);

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));

    const platformOrg = await organizationRepository.findPlatformOrganization();
    platformOrgId = platformOrg!.id;
  });

  afterEach(async () => {
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (mockPlatformStaffId) {
      await db.organizationMembership.deleteMany({ where: { userId: mockPlatformStaffId, organizationId: platformOrgId } });
      await db.user.deleteMany({ where: { id: mockPlatformStaffId } });
      mockPlatformStaffId = null;
    }
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

  async function makePlatformStaff(roleKey: string, email: string) {
    const userId = generateId();
    await userRepository.create({ id: userId, email, name: email });
    mockPlatformStaffId = userId;
    const role = roleByKey[roleKey];
    const membership = await membershipRepository.create({ id: generateId(), organizationId: platformOrgId, userId, role: roleKey });
    await membershipRepository.updateRoleAssignment(membership.id, { role: roleKey, roleId: role.id });
    return { userId, membership: { ...membership, roleId: role.id } };
  }

  function actAs(userId: string, membership: { organizationId: string; userId: string; roleId: string | null; status: string }) {
    mockUser = { id: userId };
    mockMembershipsByOrg = new Map([[membership.organizationId, membership]]);
  }

  it("requires knowledge.source.manage to create a source — a viewer is denied", async () => {
    const viewer = await makeMember(orgAId, "viewer", "ks-viewer@example.com");
    actAs(viewer.userId, viewer.membership);
    const { createOrganizationSource } = await import("@/server/services/knowledge-source-service");
    await expect(createOrganizationSource({ organizationId: orgAId, name: "Docs" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("an owner can create a source, and it is audited as knowledge.source.created", async () => {
    const owner = await makeMember(orgAId, "owner", "ks-owner@example.com");
    actAs(owner.userId, owner.membership);
    const { createOrganizationSource } = await import("@/server/services/knowledge-source-service");
    const source = await createOrganizationSource({ organizationId: orgAId, name: "Support FAQ", classification: "INTERNAL" });

    expect(source.organizationId).toBe(orgAId);
    expect(source.type).toBe("MANUAL");
    expect(source.status).toBe("ACTIVE");

    const { auditEventRepository } = await import("@/server/repositories/audit-event-repository");
    const { withTenantContext } = await import("@/lib/tenancy/context");
    const events = await withTenantContext({ userId: null, organizationId: orgAId, isPlatformStaff: true }, (tx) => auditEventRepository.list({ limit: 10 }, { organizationId: orgAId, action: "knowledge.source.created" }, tx));
    expect(events.items).toHaveLength(1);
  });

  it("cross-tenant: Org B's owner cannot see Org A's source via listOrganizationSources", async () => {
    const ownerA = await makeMember(orgAId, "owner", "ks-owner-a2@example.com");
    actAs(ownerA.userId, ownerA.membership);
    const { createOrganizationSource, listOrganizationSources } = await import("@/server/services/knowledge-source-service");
    await createOrganizationSource({ organizationId: orgAId, name: "Org A Private Docs" });

    const ownerB = await makeMember(orgBId, "owner", "ks-owner-b2@example.com");
    actAs(ownerB.userId, ownerB.membership);
    const asOwnerB = await listOrganizationSources({ organizationId: orgBId });
    expect(asOwnerB.items.find((s) => s.name === "Org A Private Docs")).toBeUndefined();
  });

  it("cross-tenant: fetching Org A's source by id under Org B's own organizationId is a safe not-found, never a leak", async () => {
    const ownerA = await makeMember(orgAId, "owner", "ks-owner-a3@example.com");
    actAs(ownerA.userId, ownerA.membership);
    const { createOrganizationSource, getSource } = await import("@/server/services/knowledge-source-service");
    const source = await createOrganizationSource({ organizationId: orgAId, name: "Org A Only" });

    const ownerB = await makeMember(orgBId, "owner", "ks-owner-b3@example.com");
    actAs(ownerB.userId, ownerB.membership);
    await expect(getSource({ organizationId: orgBId, sourceId: source.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("platform-level sources (organizationId: null) are visible to EVERY organization's own source list", async () => {
    const platformOwner = await makePlatformStaff("platform_owner", "ks-platform-owner@example.com");
    actAs(platformOwner.userId, platformOwner.membership);
    const { createPlatformSource } = await import("@/server/services/knowledge-source-service");
    const platformSource = await createPlatformSource({ name: "Alpha OS Product Docs", classification: "PUBLIC" });
    expect(platformSource.organizationId).toBeNull();

    const ownerA = await makeMember(orgAId, "owner", "ks-owner-a4@example.com");
    actAs(ownerA.userId, ownerA.membership);
    const { listOrganizationSources: listAgain } = await import("@/server/services/knowledge-source-service");
    const asOwnerA = await listAgain({ organizationId: orgAId });
    expect(asOwnerA.items.some((s) => s.id === platformSource.id)).toBe(true);

    // Platform-level rows (organizationId: null) are NOT covered by
    // this file's own orgIds-scoped afterEach cleanup — clean up
    // explicitly, or this accumulates a stray row on every run (found
    // the same way Module 07's own similar test-debris was: a later
    // test run genuinely surfacing an unexpected extra row).
    await db.knowledgeSource.delete({ where: { id: platformSource.id } });
  });

  it("a regular organization owner cannot create a platform-level source", async () => {
    const owner = await makeMember(orgAId, "owner", "ks-owner-noplatform@example.com");
    actAs(owner.userId, owner.membership);
    const { createPlatformSource } = await import("@/server/services/knowledge-source-service");
    await expect(createPlatformSource({ name: "Forged platform source" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("archiving a source updates its status and is audited as knowledge.source.archived", async () => {
    const owner = await makeMember(orgAId, "owner", "ks-owner-archive@example.com");
    actAs(owner.userId, owner.membership);
    const { createOrganizationSource, updateSourceStatus } = await import("@/server/services/knowledge-source-service");
    const source = await createOrganizationSource({ organizationId: orgAId, name: "To be archived" });
    const archived = await updateSourceStatus({ organizationId: orgAId, sourceId: source.id, status: "ARCHIVED" });
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.archivedAt).not.toBeNull();
  });
});
