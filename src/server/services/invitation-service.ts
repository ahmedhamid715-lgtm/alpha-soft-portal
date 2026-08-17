import "server-only";
import { z } from "zod";
import type { Invitation } from "@/generated/prisma/client";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { ConflictError, NotFoundError, ValidationError, RateLimitError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging";
import { events } from "@/lib/platform/events";
import { invitationRateLimiter } from "@/lib/platform/rate-limit";
import { generateRawToken, hashToken } from "@/lib/auth/tokens";
import { hashPassword } from "@/lib/auth/password";
import { passwordSchema } from "@/lib/auth/password-policy";
import { sendInvitationEmail } from "@/lib/mail/mailer";
import { invitationRepository } from "@/server/repositories/invitation-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { userRepository, normalizeEmail } from "@/server/repositories/user-repository";
import { getCurrentUser } from "@/lib/auth/session-guard";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { appConfig } from "@/config/app";
import { audit } from "@/lib/audit/service";

/**
 * Organization invitations (spec sections 11–16) — the enterprise
 * onboarding entry point: `admin invites → invitation created → email
 * sent (event contract for Module 09) → recipient accepts → membership
 * created with the offered role`. See docs/architecture/invitations.md
 * for the full lifecycle/security writeup this file implements.
 *
 * Token handling mirrors `password-reset-service.ts`/
 * `email-verification-service.ts` exactly (spec section 12: same
 * primitives, `lib/auth/tokens.ts`) — a 256-bit random token, delivered
 * once, never persisted; only its SHA-256 hash lives in `tokenHash`.
 */

const INVITATION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — long enough for a real person to see the email, short enough to bound a leaked link's usefulness.

const createInvitationSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().email(),
  roleId: z.string().uuid(),
});

/**
 * Issues an invitation. Every defense lives here, the single chokepoint
 * (mirrors `role-service.ts`'s `assignRole()` — spec section 17: "do
 * not recreate role logic"):
 *
 *   1. **Permission gate**: `members.invite`, organization-scoped — only
 *      `owner`/`admin` hold it in the system role catalog (`roles.ts`),
 *      so a `MEMBER`/`VIEWER` inviting *anyone*, at *any* role, fails
 *      here before anything else runs (spec section 18's escalation
 *      matrix).
 *   2. **Role scope/ownership validation** — identical checks
 *      `assignRole()` already uses (the role must be a system role or
 *      belong to this exact organization, and must be `ORGANIZATION`-
 *      scope, never `PLATFORM`) — reused, not reimplemented.
 *   3. **Duplicate/conflict checks** (spec section 15): an existing
 *      `PENDING` invitation for this email, or an existing `ACTIVE`
 *      membership, both reject with a clear, deterministic error —
 *      backed by the database's own partial unique index
 *      (`organization_invitations_pending_email_key`) as defense in
 *      depth against a race between the pre-check and the insert.
 *   4. **Rate limiting** (spec section 42) — `invitationRateLimiter`,
 *      per-organization.
 */
export async function createInvitation(rawInput: unknown): Promise<Invitation> {
  const input = parseOrThrow(createInvitationSchema, rawInput);
  const context = await requirePermission("members.invite", input.organizationId);

  const rateLimit = await invitationRateLimiter.check(`invite:${input.organizationId}`);
  if (!rateLimit.allowed) {
    throw new RateLimitError("Too many invitations sent recently. Try again shortly.");
  }

  const organization = await organizationRepository.findById(input.organizationId);
  if (!organization) throw new NotFoundError("Organization");

  const role = await roleRepository.findById(input.roleId);
  if (!role) throw new NotFoundError("Role");
  if (role.scope !== "ORGANIZATION") {
    throw new ValidationError("Only organization-scope roles can be offered through an invitation.");
  }
  if (!role.isSystem && role.organizationId !== input.organizationId) {
    throw new ValidationError("A custom role can only be offered by the organization that created it.");
  }

  const email = normalizeEmail(input.email);

  const existingInvitation = await invitationRepository.findPendingByOrganizationAndEmail(input.organizationId, email);
  if (existingInvitation) {
    throw new ConflictError("This email already has a pending invitation to this organization.", {
      details: { field: "email" },
    });
  }

  const existingUser = await userRepository.findByEmail(email);
  if (existingUser) {
    const existingMembership = await membershipRepository.findByOrganizationAndUser(input.organizationId, existingUser.id);
    if (existingMembership && existingMembership.status !== "SUSPENDED") {
      throw new ConflictError("This email is already a member of this organization.", { details: { field: "email" } });
    }
  }

  const rawTokenValue = generateRawToken();
  const invitation = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    async (tx) => {
      const created = await invitationRepository.create(
        {
          id: generateId(),
          organizationId: input.organizationId,
          email,
          roleId: input.roleId,
          invitedByUserId: context.user!.id,
          tokenHash: hashToken(rawTokenValue),
          expiresAt: new Date(Date.now() + INVITATION_DURATION_MS),
        },
        tx,
      );
      await audit.recordSuccess({
        action: "organization.member.invited",
        organizationId: input.organizationId,
        resourceType: "invitation",
        resourceId: created.id,
        resourceName: email,
        newState: { email, roleId: input.roleId },
        tx,
      });
      return created;
    },
  );

  const acceptUrl = `${appConfig.url}/invitations/accept?token=${rawTokenValue}`;
  await sendInvitationEmail(email, organization.displayName, acceptUrl);

  logger.info("Invitation created.", {
    operation: "invitation.create",
    organizationId: input.organizationId,
    invitationId: invitation.id,
    invitedByUserId: context.user!.id,
  });
  await events.emit("organization.member.invited", {
    invitationId: invitation.id,
    organizationId: input.organizationId,
    invitedByUserId: context.user!.id,
  });

  return invitation;
}

const acceptInvitationSchema = z.object({
  token: z.string().min(1),
  // Only required/used for the "email does not belong to an existing
  // user" case (spec section 14) — an already-authenticated caller's
  // own `name`/password are never touched by this action (spec section
  // 24: authentication changes go through Module 04's own mechanisms).
  name: z.string().min(1).max(200).optional(),
  password: passwordSchema.optional(),
});

export type AcceptInvitationOutcome =
  | { outcome: "accepted"; organizationId: string; organizationSlug: string }
  | { outcome: "invalid" }
  | { outcome: "expired" }
  | { outcome: "already_used" }
  | { outcome: "email_mismatch" }
  | { outcome: "account_required" };

/**
 * Accepts an invitation. Never trusts a client-supplied `organizationId`/
 * `userId`/`roleId` (spec sections 16/48) — every one of those is
 * re-derived from the invitation row the token resolves to, or from
 * Module 04's own session. Two identity paths:
 *
 *   - **Already authenticated** (`getCurrentUser()` resolves someone):
 *     their session email must match the invitation's email exactly
 *     (normalized) — accepting while logged in as a *different* person
 *     than who was invited is rejected (`email_mismatch`), closing the
 *     "accept someone else's invitation while logged in as myself" IDOR
 *     spec section 48 asks about.
 *   - **Not authenticated**: the invitation is for a brand-new identity
 *     — `name`/`password` are required (`account_required` if missing)
 *     and a real `User` + `UserCredential` are created using Module 04's
 *     own `hashPassword()`, never a parallel auth mechanism.
 *
 * **Race safety** (spec sections 44/45): `invitationRepository.
 * claimForAcceptance()` is an atomic, conditional `UPDATE ... WHERE
 * status = 'PENDING'`, run inside the SAME transaction as the resulting
 * membership creation — if two requests race to accept the same token,
 * exactly one `UPDATE` can ever match the row (Postgres's own row-level
 * locking), so exactly one membership is ever created; the loser sees
 * `already_used`, not a duplicate membership or a corrupted invitation
 * row. Proven with a real concurrency test, not just reasoned about —
 * see this module's completion report "Invitation Race Testing."
 */
export async function acceptInvitation(rawInput: unknown): Promise<AcceptInvitationOutcome> {
  const input = parseOrThrow(acceptInvitationSchema, rawInput);
  const tokenHash = hashToken(input.token);

  const invitation = await invitationRepository.findByTokenHash(tokenHash);
  if (!invitation) return { outcome: "invalid" };
  if (invitation.status !== "PENDING") return { outcome: "already_used" };
  if (invitation.expiresAt.getTime() < Date.now()) return { outcome: "expired" };

  const identity = await getCurrentUser();

  let acceptingUserId: string;
  let isNewAccount = false;

  if (identity) {
    if (normalizeEmail(identity.user.email) !== invitation.email) {
      return { outcome: "email_mismatch" };
    }
    acceptingUserId = identity.user.id;
  } else {
    const existingUser = await userRepository.findByEmail(invitation.email);
    if (existingUser) {
      // A real account exists for this email but no active session —
      // the correct flow is "log in, then accept," not creating a
      // second identity. Signal this distinctly so the UI can route to
      // /login with the invitation token preserved, rather than
      // silently failing.
      return { outcome: "account_required" };
    }
    if (!input.name || !input.password) {
      return { outcome: "account_required" };
    }
    isNewAccount = true;
    acceptingUserId = ""; // resolved inside the transaction below, once we're committed to creating it
  }

  const role = await roleRepository.findById(invitation.roleId);
  if (!role) return { outcome: "invalid" }; // the role was deleted after the invitation was issued — see rbac.md's deletion-safety guarantees for why this should be unreachable in practice

  const organization = await organizationRepository.findById(invitation.organizationId);
  if (!organization) return { outcome: "invalid" };

  const result = await withTenantContext(
    { userId: identity?.user.id ?? null, organizationId: invitation.organizationId, isPlatformStaff: false },
    async (tx) => {
      if (isNewAccount) {
        const passwordHash = await hashPassword(input.password!);
        const newUser = await userRepository.create({ id: generateId(), email: invitation.email, name: input.name! }, tx);
        await tx.userCredential.create({ data: { id: generateId(), userId: newUser.id, passwordHash } });
        await tx.user.update({ where: { id: newUser.id }, data: { status: "ACTIVE", emailVerifiedAt: new Date() } });
        acceptingUserId = newUser.id;
      }

      const claimedCount = await invitationRepository.claimForAcceptance(invitation.id, acceptingUserId, tx);
      if (claimedCount === 0) {
        return null; // lost the race, or someone revoked it between our checks above and now
      }

      const existingMembership = await membershipRepository.findByOrganizationAndUser(invitation.organizationId, acceptingUserId, tx);
      if (existingMembership) {
        // Already a member (e.g. reactivating a suspended membership via
        // a fresh invite) — reassign the offered role rather than error.
        await membershipRepository.updateRoleAssignment(existingMembership.id, { role: role.key, roleId: role.id }, tx);
        if (existingMembership.status === "SUSPENDED") {
          await membershipRepository.updateStatus(existingMembership.id, "ACTIVE", tx);
        }
      } else {
        const membership = await membershipRepository.create(
          { id: generateId(), organizationId: invitation.organizationId, userId: acceptingUserId, role: role.key },
          tx,
        );
        await membershipRepository.updateRoleAssignment(membership.id, { role: role.key, roleId: role.id }, tx);
      }

      // Only the winning claim reaches here (the `claimedCount === 0`
      // race loser returned `null` above already) — exactly one audit
      // record per invitation, matching the "exactly one membership" the
      // race-safety guarantee already promises. `knownActor`, not
      // `getCurrentUser()`: the `isNewAccount` path has no session at
      // all yet, and even the already-authenticated path's session may
      // not be visible mid-transaction the same way login's isn't.
      await audit.recordSuccess({
        action: "organization.member.invitation.accepted",
        organizationId: invitation.organizationId,
        resourceType: "invitation",
        resourceId: invitation.id,
        resourceName: invitation.email,
        newState: { role: role.key },
        knownActor: { userId: acceptingUserId, displayName: isNewAccount ? (input.name ?? null) : (identity?.user.name ?? null) },
        tx,
      });

      return { userId: acceptingUserId };
    },
  );

  if (!result) return { outcome: "already_used" };

  logger.info("Invitation accepted.", {
    operation: "invitation.accept",
    organizationId: invitation.organizationId,
    invitationId: invitation.id,
    acceptedByUserId: result.userId,
  });
  await events.emit("membership.accepted", {
    invitationId: invitation.id,
    organizationId: invitation.organizationId,
    userId: result.userId,
  });

  return { outcome: "accepted", organizationId: invitation.organizationId, organizationSlug: organization.slug };
}

/**
 * Safe invitation preview for the accept page — deliberately returns
 * only what's needed to render "You've been invited to join
 * {organization} as {role}," never the invitation's internal id,
 * `tokenHash`, or who invited them (spec section 52's data-privacy
 * rule applied to this new surface). Same outcome shape as
 * `acceptInvitation` for invalid/expired/already-used, so the UI can
 * reuse one set of error states.
 */
export async function getInvitationPreview(
  rawToken: unknown,
): Promise<{ outcome: "found"; organizationName: string; roleName: string; email: string } | { outcome: "invalid" | "expired" | "already_used" }> {
  const token = z.string().min(1).parse(rawToken);
  const invitation = await invitationRepository.findByTokenHash(hashToken(token));
  if (!invitation) return { outcome: "invalid" };
  if (invitation.status !== "PENDING") return { outcome: "already_used" };
  if (invitation.expiresAt.getTime() < Date.now()) return { outcome: "expired" };

  const [organization, role] = await Promise.all([
    organizationRepository.findById(invitation.organizationId),
    roleRepository.findById(invitation.roleId),
  ]);
  if (!organization || !role) return { outcome: "invalid" };

  return { outcome: "found", organizationName: organization.displayName, roleName: role.name, email: invitation.email };
}

const invitationActionSchema = z.object({ invitationId: z.string().uuid(), organizationId: z.string().uuid() });

export async function revokeInvitation(rawInput: unknown): Promise<void> {
  const input = parseOrThrow(invitationActionSchema, rawInput);
  const context = await requirePermission("members.invite", input.organizationId);

  const invitation = await invitationRepository.findById(input.invitationId);
  if (!invitation || invitation.organizationId !== input.organizationId) {
    throw new NotFoundError("Invitation");
  }
  if (invitation.status !== "PENDING") {
    throw new ConflictError("This invitation is no longer pending.");
  }

  await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    async (tx) => {
      await invitationRepository.revoke(invitation.id, tx);
      await audit.recordSuccess({
        action: "organization.member.invitation.revoked",
        organizationId: input.organizationId,
        resourceType: "invitation",
        resourceId: invitation.id,
        resourceName: invitation.email,
        tx,
      });
    },
  );

  logger.info("Invitation revoked.", { operation: "invitation.revoke", organizationId: input.organizationId, invitationId: invitation.id });
  await events.emit("membership.revoked", { invitationId: invitation.id, organizationId: input.organizationId });
}

/** Rotates the token and extends expiry — the old link stops working the moment this succeeds (its hash no longer matches any row). */
export async function resendInvitation(rawInput: unknown): Promise<void> {
  const input = parseOrThrow(invitationActionSchema, rawInput);
  const context = await requirePermission("members.invite", input.organizationId);

  const rateLimit = await invitationRateLimiter.check(`invite:${input.organizationId}`);
  if (!rateLimit.allowed) throw new RateLimitError("Too many invitations sent recently. Try again shortly.");

  const invitation = await invitationRepository.findById(input.invitationId);
  if (!invitation || invitation.organizationId !== input.organizationId) throw new NotFoundError("Invitation");
  if (invitation.status !== "PENDING") throw new ConflictError("This invitation is no longer pending.");

  const organization = await organizationRepository.findById(input.organizationId);
  if (!organization) throw new NotFoundError("Organization");

  const rawTokenValue = generateRawToken();
  await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    async (tx) => {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { tokenHash: hashToken(rawTokenValue), expiresAt: new Date(Date.now() + INVITATION_DURATION_MS) },
      });
      await audit.recordSuccess({
        action: "organization.member.invitation.resent",
        organizationId: input.organizationId,
        resourceType: "invitation",
        resourceId: invitation.id,
        resourceName: invitation.email,
        tx,
      });
    },
  );

  const acceptUrl = `${appConfig.url}/invitations/accept?token=${rawTokenValue}`;
  await sendInvitationEmail(invitation.email, organization.displayName, acceptUrl);

  logger.info("Invitation resent.", { operation: "invitation.resend", organizationId: input.organizationId, invitationId: invitation.id });
}

const listInvitationsSchema = z.object({
  organizationId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function listInvitations(rawInput: unknown) {
  const input = parseOrThrow(listInvitationsSchema, rawInput);
  await requirePermission("members.read", input.organizationId);
  return invitationRepository.listForOrganization(input.organizationId, { page: input.page, limit: input.limit });
}
