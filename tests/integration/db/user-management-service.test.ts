import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { sessionRepository } from "@/server/repositories/session-repository";
import { emailProvider } from "@/lib/mail/mailer";
import { NotFoundError } from "@/lib/errors/app-error";

/**
 * `user-management-service.ts` (Module 10) — real Postgres, real
 * `Role`/`Permission`/`RolePermission` chain (assumes `seedRbac()` has
 * already populated system roles — same assumption
 * `authorization-engine.test.ts` already documents for itself), mocked
 * identity (same technique every authorization-adjacent integration
 * test in this project uses).
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

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    throw new Error("no request scope in tests");
  }),
}));

describe.skipIf(!isDatabaseConfigured)("user management service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let platformOrgId: string;
  let orgAId: string;

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    // The platform organization is a real, database-enforced SINGLETON
    // (`organizations_single_platform_org`, a unique index on `(true)
    // WHERE is_platform`, migration `20260816120000_platform_org_singleton`)
    // — a second `isPlatform: true` row is structurally impossible, so
    // tests reuse the one `seedRbac()` already created rather than
    // minting their own (same assumption `authorization-engine.test.ts`
    // documents for `Role`/`Permission` rows).
    const platformOrg = await organizationRepository.findPlatformOrganization();
    if (!platformOrg) throw new Error("Platform organization not seeded — run `npm run db:seed` first.");
    platformOrgId = platformOrg.id;

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "UM Test Org A", displayName: "UM Test Org A", slug: `um-org-a-${orgAId}` });
    orgIds.push(orgAId);
  });

  afterEach(async () => {
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (orgIds.length) await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    userIds.length = 0;
    orgIds.length = 0;
    vi.restoreAllMocks();
  });

  async function makePlatformStaff(roleKey: "platform_owner" | "platform_admin" | "support_admin" = "platform_owner") {
    const role = await roleRepository.findSystemRoleByKey(roleKey);
    if (!role) throw new Error(`System role "${roleKey}" not seeded — run \`npm run db:seed\` first.`);

    const userId = generateId();
    await userRepository.create({ id: userId, email: `${roleKey}-${userId}@example.com`, name: `${roleKey} test` });
    await db.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
    userIds.push(userId);

    const membership = await membershipRepository.create({ id: generateId(), organizationId: platformOrgId, userId, role: role.key });
    await membershipRepository.updateRoleAssignment(membership.id, { role: role.key, roleId: role.id });

    mockUser = { id: userId };
    mockMembershipsByOrg = new Map([[platformOrgId, { organizationId: platformOrgId, userId, roleId: role.id, status: "ACTIVE" }]]);
    return userId;
  }

  async function makeTargetUser(status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED" = "ACTIVE") {
    const userId = generateId();
    await userRepository.create({ id: userId, email: `target-${userId}@example.com`, name: "Target User" });
    await db.user.update({ where: { id: userId }, data: { status } });
    userIds.push(userId);
    return userId;
  }

  async function loadService() {
    return import("@/server/services/user-management-service");
  }

  it("listUsers() requires users.read and returns matching, filtered rows", async () => {
    const { listUsers } = await loadService();
    await makeTargetUser("ACTIVE");
    const suspended = await makeTargetUser("SUSPENDED");

    await expect(listUsers({})).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR" });

    await makePlatformStaff();
    const page = await listUsers({ status: "SUSPENDED" });
    expect(page.items.some((u) => u.id === suspended)).toBe(true);
    expect(page.items.every((u) => u.status === "SUSPENDED")).toBe(true);
  });

  it("getUserDetail() composes memberships/sessions/invitations, and scopes activity to platform-only events (never another organization's own trail)", async () => {
    const { getUserDetail } = await loadService();
    const staffId = await makePlatformStaff();
    const targetId = await makeTargetUser();

    await membershipRepository.create({ id: generateId(), organizationId: orgAId, userId: targetId, role: "member" });
    await sessionRepository.create({ id: generateId(), userId: targetId, userAgent: "test-agent", expiresAt: new Date(Date.now() + 60_000) });

    // A platform-scope event (organizationId: null) about the target — should appear.
    await db.auditEvent.create({
      data: { id: generateId(), organizationId: null, actorType: "USER" as const, actorUserId: staffId, action: "user.created", category: "ADMINISTRATION", outcome: "SUCCESS", resourceType: "user", resourceId: targetId, requestId: generateId(), correlationId: generateId() },
    });
    // An ORGANIZATION-scoped event about the target, in Org A — must NOT leak into this global view.
    await db.auditEvent.create({
      data: { id: generateId(), organizationId: orgAId, actorType: "USER" as const, actorUserId: staffId, action: "organization.member.role_changed", category: "ROLE", outcome: "SUCCESS", resourceType: "membership", resourceId: targetId, requestId: generateId(), correlationId: generateId() },
    });

    const detail = await getUserDetail({ userId: targetId });
    expect(detail.memberships.some((m) => m.organizationId === orgAId)).toBe(true);
    expect(detail.sessions).toHaveLength(1);
    expect(detail.recentActivity.some((e) => e.action === "user.created")).toBe(true);
    expect(detail.recentActivity.some((e) => e.action === "organization.member.role_changed")).toBe(false);
  });

  it("createPlatformUser() creates a user + platform membership + unusable credential + a real password-reset token, and rejects an ORGANIZATION-scope role", async () => {
    const sendSpy = vi.spyOn(emailProvider, "send").mockResolvedValue({ accepted: true });
    const { createPlatformUser } = await loadService();
    await makePlatformStaff();

    const supportAdminRole = await roleRepository.findSystemRoleByKey("support_admin");
    const created = await createPlatformUser({ email: `new-staff-${generateId()}@example.com`, name: "New Staff", roleId: supportAdminRole!.id });
    userIds.push(created.id);

    expect(sendSpy).toHaveBeenCalledOnce();
    const membership = await membershipRepository.findByOrganizationAndUser(platformOrgId, created.id);
    expect(membership?.role).toBe("support_admin");
    const credential = await db.userCredential.findUnique({ where: { userId: created.id } });
    expect(credential).not.toBeNull(); // unusable placeholder — see service's own doc comment
    const token = await db.authToken.findFirst({ where: { userId: created.id, purpose: "PASSWORD_RESET" } });
    expect(token).not.toBeNull();

    const memberRole = await roleRepository.findSystemRoleByKey("member");
    await expect(
      createPlatformUser({ email: `bad-${generateId()}@example.com`, name: "Bad", roleId: memberRole!.id }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("createPlatformUser() concurrent duplicate-email race: exactly one succeeds, the loser gets a real ConflictError from the database's own unique constraint", async () => {
    vi.spyOn(emailProvider, "send").mockResolvedValue({ accepted: true });
    const { createPlatformUser } = await loadService();
    await makePlatformStaff();

    const role = await roleRepository.findSystemRoleByKey("support_agent");
    const email = `race-${generateId()}@example.com`;

    const results = await Promise.allSettled([
      createPlatformUser({ email, name: "Racer A", roleId: role!.id }),
      createPlatformUser({ email, name: "Racer B", roleId: role!.id }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (fulfilled[0]?.status === "fulfilled") userIds.push(fulfilled[0].value.id);
    if (rejected[0]?.status === "rejected") expect((rejected[0].reason as { code?: string }).code).toBe("CONFLICT");

    const count = await db.user.count({ where: { email } });
    expect(count).toBe(1);
  });

  it("suspendUser() sets status, revokes every active session, and rejects self-suspension", async () => {
    const { suspendUser } = await loadService();
    const staffId = await makePlatformStaff();
    const targetId = await makeTargetUser();
    await sessionRepository.create({ id: generateId(), userId: targetId, expiresAt: new Date(Date.now() + 60_000) });

    await suspendUser({ userId: targetId });
    const target = await userRepository.findById(targetId);
    expect(target?.status).toBe("SUSPENDED");
    expect(await sessionRepository.listActiveForUser(targetId)).toHaveLength(0);

    await expect(suspendUser({ userId: staffId })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("suspendUser() rejects suspending the platform's last active platform_owner", async () => {
    const { suspendUser } = await loadService();
    await makePlatformStaff("platform_admin"); // acting caller — distinct from the sole owner below
    const ownerId = await makeTargetUser();
    const ownerRole = await roleRepository.findSystemRoleByKey("platform_owner");
    const membership = await membershipRepository.create({ id: generateId(), organizationId: platformOrgId, userId: ownerId, role: "platform_owner" });
    await membershipRepository.updateRoleAssignment(membership.id, { role: "platform_owner", roleId: ownerRole!.id });

    // `platformOrgId` is the real, shared, singleton platform organization
    // (see `beforeEach`'s own comment) — `seedRbac()` already gave it a
    // real `platform-owner@alpha-os.test` membership, so "the last active
    // owner" isn't naturally true for the fresh membership created above
    // without temporarily suspending every OTHER active platform_owner
    // membership first. Restored in `finally`, unconditionally, so a
    // failed assertion never leaves the shared dev database's own
    // platform-owner fixture suspended for every later test/session.
    //
    // Because this org is shared across every test FILE (Vitest runs
    // files concurrently — see this repo's own established hazard),
    // another file's platform_owner fixture can legitimately be deleted
    // (its own `afterEach`'s `user.deleteMany`, cascading) WHILE this
    // test holds it suspended. Both the suspend and restore loops are
    // tolerant of that: a row that's vanished out from under us isn't a
    // bug to propagate, it just has nothing left to restore.
    const otherActiveOwners = await db.organizationMembership.findMany({
      where: { organizationId: platformOrgId, role: "platform_owner", status: "ACTIVE", id: { not: membership.id } },
    });
    async function setStatusTolerantly(id: string, status: "ACTIVE" | "SUSPENDED") {
      try {
        await membershipRepository.updateStatus(id, status);
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
      }
    }
    try {
      for (const other of otherActiveOwners) {
        await setStatusTolerantly(other.id, "SUSPENDED");
      }

      await expect(suspendUser({ userId: ownerId })).rejects.toMatchObject({ code: "CONFLICT" });
      const stillActive = await userRepository.findById(ownerId);
      expect(stillActive?.status).toBe("ACTIVE");
    } finally {
      for (const other of otherActiveOwners) {
        await setStatusTolerantly(other.id, "ACTIVE");
      }
    }
  });

  it("reactivateUser() from DEACTIVATED requires users.delete — users.update alone (support_admin) is rejected", async () => {
    const { reactivateUser } = await loadService();
    await makePlatformStaff("support_admin"); // holds users.read only — see roles.ts
    const targetId = await makeTargetUser("DEACTIVATED");

    await expect(reactivateUser({ userId: targetId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    const stillDeactivated = await userRepository.findById(targetId);
    expect(stillDeactivated?.status).toBe("DEACTIVATED");
  });

  it("reactivateUser() from SUSPENDED succeeds for a platform_owner and never touches an independent membership suspension", async () => {
    const { reactivateUser } = await loadService();
    await makePlatformStaff();
    const targetId = await makeTargetUser("SUSPENDED");
    const membership = await membershipRepository.create({ id: generateId(), organizationId: orgAId, userId: targetId, role: "member" });
    await membershipRepository.updateStatus(membership.id, "SUSPENDED");

    await reactivateUser({ userId: targetId });
    const target = await userRepository.findById(targetId);
    expect(target?.status).toBe("ACTIVE");
    const reloadedMembership = await membershipRepository.findById(membership.id);
    expect(reloadedMembership?.status).toBe("SUSPENDED"); // unchanged — global status and membership status are never coupled
  });

  it("deactivateUser() requires users.delete and is a status flip, never a row deletion", async () => {
    const { deactivateUser } = await loadService();
    await makePlatformStaff();
    const targetId = await makeTargetUser();

    await deactivateUser({ userId: targetId });
    const target = await userRepository.findById(targetId);
    expect(target?.status).toBe("DEACTIVATED");
    expect(target?.id).toBe(targetId); // row still exists, same id — never deleted

    await expect(deactivateUser({ userId: targetId })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("revokeUserSession() is IDOR-safe — a sessionId belonging to a DIFFERENT user throws NotFoundError, never revokes it", async () => {
    const { revokeUserSession } = await loadService();
    await makePlatformStaff();
    const targetId = await makeTargetUser();
    const otherUserId = await makeTargetUser();
    const otherSession = await sessionRepository.create({ id: generateId(), userId: otherUserId, expiresAt: new Date(Date.now() + 60_000) });

    // Forged combination: a real sessionId, but claimed against the WRONG userId.
    await expect(revokeUserSession({ userId: targetId, sessionId: otherSession.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const reloaded = await sessionRepository.findById(otherSession.id);
    expect(reloaded?.revokedAt).toBeNull();
  });
});
