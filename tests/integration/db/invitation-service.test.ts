import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { invitationRepository } from "@/server/repositories/invitation-repository";
import { invitationPolicyRepository } from "@/server/repositories/invitation-policy-repository";
import { generateRawToken, hashToken } from "@/lib/auth/tokens";

/**
 * Invitation lifecycle + the mandatory race test (spec sections 11–16,
 * 44, 45) — real Postgres, real RLS (via `withTenantContext`), a mocked
 * identity (the same technique every authorization-adjacent integration
 * test in this project uses since Module 05).
 */

let mockUser: { id: string; email?: string } | null = null;
let mockMembershipsByOrg = new Map<string, { organizationId: string; userId: string; roleId: string | null; status: string }>();

vi.mock("@/lib/auth/session-guard", () => ({
  getCurrentUser: vi.fn(async () => (mockUser ? { user: mockUser, sessionId: "test-session" } : null)),
  getCurrentMembership: vi.fn(async (organizationId?: string) => {
    if (organizationId) return mockMembershipsByOrg.get(organizationId) ?? null;
    return mockMembershipsByOrg.size === 1 ? [...mockMembershipsByOrg.values()][0] : null;
  }),
}));

describe.skipIf(!isDatabaseConfigured)("invitation-service (database integration)", () => {
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let orgAId: string;
  let roleByKey: Record<string, { id: string; key: string }> = {};

  beforeEach(async () => {
    mockUser = null;
    mockMembershipsByOrg = new Map();

    orgAId = generateId();
    await organizationRepository.create({ id: orgAId, name: "Invite Test Org", displayName: "Invite Test Org", slug: `invite-org-${orgAId}` });
    orgIds.push(orgAId);

    const roles = await roleRepository.listSystemRoles();
    roleByKey = Object.fromEntries(roles.map((r) => [r.key, { id: r.id, key: r.key }]));
  });

  afterEach(async () => {
    // Organizations FIRST — cascade-deletes their Invitation rows too
    // (Invitation.organizationId is onDelete: Cascade). Only then can
    // users be deleted: Invitation.invitedByUserId is onDelete: Restrict
    // (the same deliberate protection role-service.ts's Role deletion
    // has — see schema.prisma), so deleting a user who is still
    // referenced as an invitation's inviter fails until the invitation
    // itself is gone.
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

  // --- Basic lifecycle ---------------------------------------------------

  it("an owner can invite a new email and the invitation is created with a hashed, never-raw token", async () => {
    const { createInvitation } = await import("@/server/services/invitation-service");
    const owner = await makeMember(orgAId, "owner", "invite-owner@example.com");
    actAs(owner.userId, owner.membership);

    const invitation = await createInvitation({ organizationId: orgAId, email: "new-person@example.com", roleId: roleByKey.member.id });
    expect(invitation.status).toBe("PENDING");
    expect(invitation.email).toBe("new-person@example.com");

    // The raw token is never persisted anywhere — only its hash.
    const raw = await db.invitation.findUnique({ where: { id: invitation.id } });
    expect(raw?.tokenHash).not.toContain(invitation.id); // sanity: not trivially derivable
    expect(raw?.tokenHash).toHaveLength(64); // SHA-256 hex digest length
  });

  it("a duplicate PENDING invitation for the same email is rejected (spec section 15)", async () => {
    const { createInvitation } = await import("@/server/services/invitation-service");
    const owner = await makeMember(orgAId, "owner", "dup-owner@example.com");
    actAs(owner.userId, owner.membership);

    await createInvitation({ organizationId: orgAId, email: "dup-target@example.com", roleId: roleByKey.member.id });
    await expect(
      createInvitation({ organizationId: orgAId, email: "dup-target@example.com", roleId: roleByKey.viewer.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("inviting an email that is already an active member is rejected", async () => {
    const { createInvitation } = await import("@/server/services/invitation-service");
    const owner = await makeMember(orgAId, "owner", "existing-owner@example.com");
    const existingMember = await makeMember(orgAId, "member", "already-member@example.com");
    actAs(owner.userId, owner.membership);

    await expect(
      createInvitation({ organizationId: orgAId, email: "already-member@example.com", roleId: roleByKey.admin.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    void existingMember;
  });

  it("a MEMBER cannot invite anyone — lacks members.invite entirely (spec section 18)", async () => {
    const { createInvitation } = await import("@/server/services/invitation-service");
    const member = await makeMember(orgAId, "member", "plain-member@example.com");
    actAs(member.userId, member.membership);

    await expect(
      createInvitation({ organizationId: orgAId, email: "target@example.com", roleId: roleByKey.viewer.id }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("an admin cannot invite someone with a PLATFORM-scope role — rejected as an invalid role offer", async () => {
    const { createInvitation } = await import("@/server/services/invitation-service");
    const admin = await makeMember(orgAId, "admin", "scope-admin@example.com");
    actAs(admin.userId, admin.membership);

    await expect(
      createInvitation({ organizationId: orgAId, email: "target2@example.com", roleId: roleByKey.platform_admin.id }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  // --- Accept: existing vs. new user, expiry, revocation -----------------

  async function issueInvitation(organizationId: string, email: string, roleKey: string, inviter: { userId: string; membership: { organizationId: string; userId: string; roleId: string | null; status: string } }) {
    actAs(inviter.userId, inviter.membership);
    const rawToken = generateRawToken();
    const role = roleByKey[roleKey];
    const invitation = await invitationRepository.create({
      id: generateId(),
      organizationId,
      email,
      roleId: role.id,
      invitedByUserId: inviter.userId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000),
    });
    return { invitation, rawToken };
  }

  it("accepting as a brand-new email creates the user, credential, and membership atomically", async () => {
    const owner = await makeMember(orgAId, "owner", "accept-owner@example.com");
    const { rawToken } = await issueInvitation(orgAId, "brand-new@example.com", "member", owner);

    mockUser = null; // unauthenticated — the "new user" path
    const { acceptInvitation } = await import("@/server/services/invitation-service");
    const result = await acceptInvitation({ token: rawToken, name: "Brand New Person", password: "a-genuinely-long-password-123" });
    expect(result.outcome).toBe("accepted");

    const newUser = await userRepository.findByEmail("brand-new@example.com");
    expect(newUser).not.toBeNull();
    userIds.push(newUser!.id);
    const membership = await membershipRepository.findByOrganizationAndUser(orgAId, newUser!.id);
    expect(membership?.role).toBe("member");
    expect(membership?.status).toBe("ACTIVE");
  });

  it("accepting while authenticated as a DIFFERENT email than the invitation is rejected (spec section 48 IDOR)", async () => {
    const owner = await makeMember(orgAId, "owner", "mismatch-owner@example.com");
    const { rawToken } = await issueInvitation(orgAId, "intended-recipient@example.com", "member", owner);

    const wrongUser = await makeMember(orgAId, "viewer", "wrong-person@example.com");
    actAs(wrongUser.userId, wrongUser.membership);
    mockUser = { id: wrongUser.userId, email: "wrong-person@example.com" }; // actAs() doesn't carry email (most tests don't need it) — this one specifically does

    const { acceptInvitation } = await import("@/server/services/invitation-service");
    const result = await acceptInvitation({ token: rawToken });
    expect(result.outcome).toBe("email_mismatch");

    // Confirm no membership was granted to the wrong person.
    const membership = await membershipRepository.findByOrganizationAndUser(orgAId, wrongUser.userId);
    expect(membership?.role).toBe("viewer"); // unchanged from their real, pre-existing role
  });

  it("an expired invitation cannot be accepted", async () => {
    const owner = await makeMember(orgAId, "owner", "expiry-owner@example.com");
    actAs(owner.userId, owner.membership);
    const rawToken = generateRawToken();
    await invitationRepository.create({
      id: generateId(),
      organizationId: orgAId,
      email: "expired-target@example.com",
      roleId: roleByKey.member.id,
      invitedByUserId: owner.userId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() - 1000),
    });

    mockUser = null;
    const { acceptInvitation } = await import("@/server/services/invitation-service");
    const result = await acceptInvitation({ token: rawToken, name: "Late Person", password: "another-long-password-456" });
    expect(result.outcome).toBe("expired");
  });

  it("a revoked invitation cannot be accepted", async () => {
    const owner = await makeMember(orgAId, "owner", "revoke-owner@example.com");
    const { invitation, rawToken } = await issueInvitation(orgAId, "revoked-target@example.com", "member", owner);

    const { revokeInvitation } = await import("@/server/services/invitation-service");
    actAs(owner.userId, owner.membership);
    await revokeInvitation({ invitationId: invitation.id, organizationId: orgAId });

    mockUser = null;
    const { acceptInvitation } = await import("@/server/services/invitation-service");
    const result = await acceptInvitation({ token: rawToken, name: "Too Late", password: "yet-another-password-789" });
    expect(result.outcome).toBe("already_used");
  });

  it("a garbage/invalid token is rejected without leaking anything", async () => {
    mockUser = null;
    const { acceptInvitation } = await import("@/server/services/invitation-service");
    const result = await acceptInvitation({ token: "not-a-real-token-at-all" });
    expect(result.outcome).toBe("invalid");
  });

  it("cross-tenant IDOR: an owner cannot revoke another organization's invitation by forging organizationId (spec section 48)", async () => {
    const orgBId = generateId();
    await organizationRepository.create({ id: orgBId, name: "Invite Test Org B", displayName: "Invite Test Org B", slug: `invite-org-b-${orgBId}` });
    orgIds.push(orgBId);

    const ownerA = await makeMember(orgAId, "owner", "cross-revoke-owner-a@example.com");
    const { invitation } = await issueInvitation(orgAId, "cross-revoke-target@example.com", "member", ownerA);

    const ownerB = await makeMember(orgBId, "owner", "cross-revoke-owner-b@example.com");
    actAs(ownerB.userId, ownerB.membership);

    const { revokeInvitation } = await import("@/server/services/invitation-service");
    // Org B's owner supplies Org A's real invitationId alongside Org
    // A's own organizationId — `requirePermission("members.invite",
    // organizationId)` resolves the caller's ACTUAL membership in that
    // organization, which owner-b has none of, so this must fail before
    // ever touching the invitation row itself.
    await expect(revokeInvitation({ invitationId: invitation.id, organizationId: orgAId })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });

    const stillPending = await invitationRepository.findById(invitation.id);
    expect(stillPending?.status).toBe("PENDING");
  });

  // --- Module 12: invitation policy enforcement ---------------------------
  // `createInvitation()`/`resendInvitation()` are the ONE real chokepoint
  // `organization-security-service.ts`'s own policy is enforced through
  // (see that file's top comment) — these tests prove it's actually
  // wired, not just documented as intended.

  it("requireOwnerForInvitations blocks an admin from inviting, even though admin normally holds members.invite", async () => {
    const { createInvitation } = await import("@/server/services/invitation-service");
    const admin = await makeMember(orgAId, "admin", "policy-require-owner-admin@example.com");
    await invitationPolicyRepository.upsert({ organizationId: orgAId, requireOwnerForInvitations: true, allowedDomains: [], blockedDomains: [], invitationExpiryHours: 168 });
    actAs(admin.userId, admin.membership);

    await expect(createInvitation({ organizationId: orgAId, email: "blocked-by-policy@example.com", roleId: roleByKey.member.id })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("requireOwnerForInvitations still allows the owner themself to invite", async () => {
    const { createInvitation } = await import("@/server/services/invitation-service");
    const owner = await makeMember(orgAId, "owner", "policy-require-owner-owner@example.com");
    await invitationPolicyRepository.upsert({ organizationId: orgAId, requireOwnerForInvitations: true, allowedDomains: [], blockedDomains: [], invitationExpiryHours: 168 });
    actAs(owner.userId, owner.membership);

    await expect(
      createInvitation({ organizationId: orgAId, email: "allowed-owner-sent@example.com", roleId: roleByKey.member.id }),
    ).resolves.toMatchObject({ status: "PENDING" });
  });

  it("a blocked domain rejects the invitation even for the owner", async () => {
    const { createInvitation } = await import("@/server/services/invitation-service");
    const owner = await makeMember(orgAId, "owner", "policy-blocked-domain-owner@example.com");
    await invitationPolicyRepository.upsert({ organizationId: orgAId, requireOwnerForInvitations: false, allowedDomains: [], blockedDomains: ["blocked.example"], invitationExpiryHours: 168 });
    actAs(owner.userId, owner.membership);

    await expect(createInvitation({ organizationId: orgAId, email: "someone@blocked.example", roleId: roleByKey.member.id })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("a non-empty allowedDomains list rejects any email outside it", async () => {
    const { createInvitation } = await import("@/server/services/invitation-service");
    const owner = await makeMember(orgAId, "owner", "policy-allowed-domain-owner@example.com");
    await invitationPolicyRepository.upsert({ organizationId: orgAId, requireOwnerForInvitations: false, allowedDomains: ["allowed.example"], blockedDomains: [], invitationExpiryHours: 168 });
    actAs(owner.userId, owner.membership);

    await expect(createInvitation({ organizationId: orgAId, email: "someone@other.example", roleId: roleByKey.member.id })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      createInvitation({ organizationId: orgAId, email: "someone@allowed.example", roleId: roleByKey.member.id }),
    ).resolves.toMatchObject({ status: "PENDING" });
  });

  it("allowedDomains does NOT implicitly match a subdomain of a listed domain", async () => {
    const { createInvitation } = await import("@/server/services/invitation-service");
    const owner = await makeMember(orgAId, "owner", "policy-subdomain-owner@example.com");
    await invitationPolicyRepository.upsert({ organizationId: orgAId, requireOwnerForInvitations: false, allowedDomains: ["example.com"], blockedDomains: [], invitationExpiryHours: 168 });
    actAs(owner.userId, owner.membership);

    await expect(
      createInvitation({ organizationId: orgAId, email: "someone@mail.example.com", roleId: roleByKey.member.id }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("the configured invitationExpiryHours is honored on the created invitation's expiresAt", async () => {
    const { createInvitation } = await import("@/server/services/invitation-service");
    const owner = await makeMember(orgAId, "owner", "policy-expiry-owner@example.com");
    await invitationPolicyRepository.upsert({ organizationId: orgAId, requireOwnerForInvitations: false, allowedDomains: [], blockedDomains: [], invitationExpiryHours: 2 });
    actAs(owner.userId, owner.membership);

    const before = Date.now();
    const invitation = await createInvitation({ organizationId: orgAId, email: "expiry-check@example.com", roleId: roleByKey.member.id });
    const expectedMs = 2 * 60 * 60 * 1000;
    const actualMs = invitation.expiresAt.getTime() - before;
    expect(actualMs).toBeGreaterThan(expectedMs - 5_000);
    expect(actualMs).toBeLessThan(expectedMs + 5_000);
  });

  it("resendInvitation() re-validates against the CURRENT policy, not the one in effect when originally created — closes the tighten-then-resend back door", async () => {
    const { createInvitation, resendInvitation } = await import("@/server/services/invitation-service");
    const owner = await makeMember(orgAId, "owner", "policy-resend-owner@example.com");
    actAs(owner.userId, owner.membership);
    const invitation = await createInvitation({ organizationId: orgAId, email: "resend-target@blocked-later.example", roleId: roleByKey.member.id });

    await invitationPolicyRepository.upsert({ organizationId: orgAId, requireOwnerForInvitations: false, allowedDomains: [], blockedDomains: ["blocked-later.example"], invitationExpiryHours: 168 });

    await expect(resendInvitation({ organizationId: orgAId, invitationId: invitation.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("an organization with no customized policy behaves exactly as before Module 12 — no policy row, no restriction", async () => {
    const { createInvitation } = await import("@/server/services/invitation-service");
    const admin = await makeMember(orgAId, "admin", "policy-no-row-admin@example.com");
    actAs(admin.userId, admin.membership);

    await expect(
      createInvitation({ organizationId: orgAId, email: "unrestricted@anywhere.example", roleId: roleByKey.member.id }),
    ).resolves.toMatchObject({ status: "PENDING" });
  });

  // --- Section 45: the mandatory invitation race test ---------------------

  it("two concurrent accept requests for the SAME invitation: exactly one succeeds, no duplicate membership", async () => {
    // Isolates the specific race spec section 45 asks for — the
    // invitation-claim atomicity — from a DIFFERENT race (two concurrent
    // `User.email`-unique-constraint-colliding account creations, a
    // separate concern the "brand-new email" test above already covers
    // in the single-request case). Using an already-existing, already-
    // authenticated identity for both concurrent calls means both hit
    // the exact same code path racing on the exact same thing:
    // `invitationRepository.claimForAcceptance()`'s atomic `UPDATE ...
    // WHERE status = 'PENDING'`.
    const owner = await makeMember(orgAId, "owner", "race-owner@example.com");
    const recipient = await userRepository.create({ id: generateId(), email: "race-target@example.com", name: "Racer" });
    userIds.push(recipient.id);
    const { rawToken } = await issueInvitation(orgAId, "race-target@example.com", "member", owner);

    mockUser = { id: recipient.id, email: "race-target@example.com" };
    mockMembershipsByOrg = new Map(); // recipient has no membership anywhere yet — matches getCurrentMembership()'s real "0 memberships → null" behavior
    const { acceptInvitation } = await import("@/server/services/invitation-service");

    const [resultA, resultB] = await Promise.all([
      acceptInvitation({ token: rawToken }),
      acceptInvitation({ token: rawToken }),
    ]);

    const outcomes = [resultA.outcome, resultB.outcome].sort();
    expect(outcomes).toEqual(["accepted", "already_used"]);

    // Exactly one membership, never two, never zero.
    const memberships = await db.organizationMembership.findMany({ where: { organizationId: orgAId, userId: recipient.id } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe("member");

    // The invitation itself settled into exactly one final state.
    const finalInvitation = await db.invitation.findFirst({ where: { organizationId: orgAId, email: "race-target@example.com" } });
    expect(finalInvitation?.status).toBe("ACCEPTED");
    expect(finalInvitation?.acceptedByUserId).toBe(recipient.id);
  });
});
