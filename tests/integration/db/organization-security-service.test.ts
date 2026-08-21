import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";

/**
 * `organization-security-service.ts` (Module 12) — the invitation policy
 * read/write surface: permission gating (`organizations.security.read`/
 * `.update`, the owner-only split — see `roles.ts`), validation, audit,
 * and notification fan-out. Cross-tenant/IDOR coverage complementary to
 * `organization-invitation-policy-rls.test.ts` (raw database policy
 * proof) — this file exercises the SERVICE layer's own authorization
 * chain on top of that, same division of labor as
 * `organization-management-service.test.ts`/`organization-*-rls.test.ts`.
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

describe.skipIf(!isDatabaseConfigured)("organization-security-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let orgBId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Security Org A", displayName: "Security Org A", slug: `security-org-a-${orgAId}` });
    orgIds.push(orgAId);
    orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "Security Org B", displayName: "Security Org B", slug: `security-org-b-${orgBId}` });
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

  // --- getInvitationPolicy: defaults + read permission ----------------------

  it("a never-customized organization returns the documented code-level defaults, isCustomized: false", async () => {
    const { getInvitationPolicy } = await import("@/server/services/organization-security-service");
    const owner = await makeMember(orgAId, "owner", "defaults-owner@example.com");
    actAs(owner.userId, owner.membership);

    const policy = await getInvitationPolicy({ organizationId: orgAId });
    expect(policy).toMatchObject({
      isCustomized: false,
      requireOwnerForInvitations: false,
      allowedDomains: [],
      blockedDomains: [],
      invitationExpiryHours: 168,
    });
  });

  it("admin can READ the invitation policy (organizations.security.read, via ORGANIZATION_FULL)", async () => {
    const { getInvitationPolicy } = await import("@/server/services/organization-security-service");
    const admin = await makeMember(orgAId, "admin", "read-admin@example.com");
    actAs(admin.userId, admin.membership);

    await expect(getInvitationPolicy({ organizationId: orgAId })).resolves.toMatchObject({ organizationId: orgAId });
  });

  it("member cannot read the invitation policy (escalation)", async () => {
    const { getInvitationPolicy } = await import("@/server/services/organization-security-service");
    const member = await makeMember(orgAId, "member", "read-denied-member@example.com");
    actAs(member.userId, member.membership);

    await expect(getInvitationPolicy({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("Org B's admin cannot read Org A's invitation policy (cross-tenant IDOR via forged organizationId)", async () => {
    const { getInvitationPolicy } = await import("@/server/services/organization-security-service");
    const adminB = await makeMember(orgBId, "admin", "cross-read-admin-b@example.com");
    actAs(adminB.userId, adminB.membership);

    await expect(getInvitationPolicy({ organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  // --- updateInvitationPolicy: owner-only write ------------------------------

  it("the owner can update the invitation policy; isCustomized becomes true", async () => {
    const { updateInvitationPolicy, getInvitationPolicy } = await import("@/server/services/organization-security-service");
    const owner = await makeMember(orgAId, "owner", "update-owner@example.com");
    actAs(owner.userId, owner.membership);

    const updated = await updateInvitationPolicy({
      organizationId: orgAId,
      requireOwnerForInvitations: true,
      allowedDomains: ["Example.COM"],
      blockedDomains: [],
      invitationExpiryHours: 48,
    });
    expect(updated).toMatchObject({ isCustomized: true, requireOwnerForInvitations: true, allowedDomains: ["example.com"], invitationExpiryHours: 48 });

    const reread = await getInvitationPolicy({ organizationId: orgAId });
    expect(reread).toMatchObject({ isCustomized: true, requireOwnerForInvitations: true });
  });

  it("an admin (holds organizations.security.read but NOT .update) cannot change the policy — the deliberate owner-only split (spec's own self-escalation concern)", async () => {
    const { updateInvitationPolicy } = await import("@/server/services/organization-security-service");
    const admin = await makeMember(orgAId, "admin", "escalation-admin@example.com");
    actAs(admin.userId, admin.membership);

    await expect(
      updateInvitationPolicy({ organizationId: orgAId, requireOwnerForInvitations: false, allowedDomains: [], blockedDomains: [], invitationExpiryHours: 168 }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("a member cannot change the policy (escalation)", async () => {
    const { updateInvitationPolicy } = await import("@/server/services/organization-security-service");
    const member = await makeMember(orgAId, "member", "escalation-member@example.com");
    actAs(member.userId, member.membership);

    await expect(
      updateInvitationPolicy({ organizationId: orgAId, requireOwnerForInvitations: false, allowedDomains: [], blockedDomains: [], invitationExpiryHours: 168 }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("Org B's owner cannot update Org A's policy (cross-tenant IDOR via forged organizationId)", async () => {
    const { updateInvitationPolicy } = await import("@/server/services/organization-security-service");
    const ownerB = await makeMember(orgBId, "owner", "cross-update-owner-b@example.com");
    actAs(ownerB.userId, ownerB.membership);

    await expect(
      updateInvitationPolicy({ organizationId: orgAId, requireOwnerForInvitations: true, allowedDomains: [], blockedDomains: [], invitationExpiryHours: 168 }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("an unauthenticated caller is denied (401, not 403)", async () => {
    const { updateInvitationPolicy } = await import("@/server/services/organization-security-service");
    mockUser = null;
    mockMembershipsByOrg = new Map();

    await expect(
      updateInvitationPolicy({ organizationId: orgAId, requireOwnerForInvitations: true, allowedDomains: [], blockedDomains: [], invitationExpiryHours: 168 }),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR" });
  });

  // --- Validation --------------------------------------------------------

  it("rejects a full email address in the domain list, not silently reinterpreting it", async () => {
    const { updateInvitationPolicy } = await import("@/server/services/organization-security-service");
    const owner = await makeMember(orgAId, "owner", "validation-owner@example.com");
    actAs(owner.userId, owner.membership);

    await expect(
      updateInvitationPolicy({ organizationId: orgAId, requireOwnerForInvitations: false, allowedDomains: ["user@example.com"], blockedDomains: [], invitationExpiryHours: 168 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a domain present in BOTH the allowed and blocked lists", async () => {
    const { updateInvitationPolicy } = await import("@/server/services/organization-security-service");
    const owner = await makeMember(orgAId, "owner", "overlap-owner@example.com");
    actAs(owner.userId, owner.membership);

    await expect(
      updateInvitationPolicy({
        organizationId: orgAId,
        requireOwnerForInvitations: false,
        allowedDomains: ["example.com"],
        blockedDomains: ["example.com"],
        invitationExpiryHours: 168,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects an out-of-bounds invitation expiry (spec: bounded, not unlimited)", async () => {
    const { updateInvitationPolicy } = await import("@/server/services/organization-security-service");
    const owner = await makeMember(orgAId, "owner", "bounds-owner@example.com");
    actAs(owner.userId, owner.membership);

    await expect(
      updateInvitationPolicy({ organizationId: orgAId, requireOwnerForInvitations: false, allowedDomains: [], blockedDomains: [], invitationExpiryHours: 0 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      updateInvitationPolicy({ organizationId: orgAId, requireOwnerForInvitations: false, allowedDomains: [], blockedDomains: [], invitationExpiryHours: 721 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  // --- Audit + notification integration -----------------------------------

  it("updating the policy writes an audit event with previous/new state, and notifies owner+admin (never member/viewer, never the actor themself)", async () => {
    await import("@/lib/notifications/subscribers");
    const { updateInvitationPolicy } = await import("@/server/services/organization-security-service");
    const { emailProvider } = await import("@/lib/mail/mailer");
    const sendSpy = vi.spyOn(emailProvider, "send").mockResolvedValue({ accepted: true });

    const owner = await makeMember(orgAId, "owner", "audit-owner@example.com");
    const admin = await makeMember(orgAId, "admin", "audit-admin@example.com");
    const member = await makeMember(orgAId, "member", "audit-member@example.com");
    actAs(owner.userId, owner.membership);

    await updateInvitationPolicy({ organizationId: orgAId, requireOwnerForInvitations: true, allowedDomains: [], blockedDomains: [], invitationExpiryHours: 72 });

    const auditEvent = await db.auditEvent.findFirst({ where: { organizationId: orgAId, action: "organization.invitation_policy.updated" } });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.newState).toMatchObject({ requireOwnerForInvitations: true, invitationExpiryHours: 72 });

    const notifications = await db.notification.findMany({ where: { organizationId: orgAId, sourceEventType: "organization.invitation_policy.updated" } });
    const recipients = notifications.map((n) => n.recipientUserId);
    expect(recipients).toContain(admin.userId);
    expect(recipients).not.toContain(member.userId); // member holds neither organizations.security.read nor members.invite — not meaningful information for them
    expect(recipients).not.toContain(owner.userId); // the actor doesn't notify themself
    expect(sendSpy).toHaveBeenCalled();
  });
});
