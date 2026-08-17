import "server-only";
import { z } from "zod";
import type { User } from "@/generated/prisma/client";
import { generateId } from "@/lib/utils/id";
import { generateRawToken, hashToken } from "@/lib/auth/tokens";
import { hashPassword } from "@/lib/auth/password";
import { sendWelcomeEmail } from "@/lib/mail/mailer";
import { parseOrThrow, optionalFromQueryParam } from "@/lib/validation/parse";
import { ConflictError, NotFoundError, ValidationError, AuthenticationError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { appConfig } from "@/config/app";
import { requirePermission } from "@/lib/authorization/authorize";
import { getCurrentUser } from "@/lib/auth/session-guard";
import { withTenantContext } from "@/lib/tenancy/context";
import type { CursorPaginatedResult } from "@/lib/platform/pagination";
import { userRepository, normalizeEmail } from "@/server/repositories/user-repository";
import { credentialRepository } from "@/server/repositories/credential-repository";
import { authTokenRepository } from "@/server/repositories/auth-token-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { invitationRepository } from "@/server/repositories/invitation-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { sessionRepository } from "@/server/repositories/session-repository";
import { sessionService } from "./session-service";

/**
 * Module 10 — the platform-wide, administrative user-management layer.
 * Everything here acts on ANOTHER person's global `User` record (or the
 * caller's own, for the directory read) under a PLATFORM-scope
 * permission (`users.read`/`users.create`/`users.update`/`users.delete`
 * — reserved by Module 05 specifically for this module, see
 * `permissions.ts`'s own top comment on the `users` resource).
 *
 * Deliberately separate from `user-profile-service.ts` (self-service,
 * identity-gated, no permission check, cannot touch `status`/anything
 * security-relevant) and from `membership-service.ts`/`role-service.ts`
 * (organization-scoped membership/role mutations, unchanged and reused
 * here, never reimplemented). See `docs/architecture/user-lifecycle.md`
 * for the full state-machine writeup and
 * `docs/architecture/user-security.md` for the trust model every
 * function below implements.
 */

// --- Directory --------------------------------------------------------

const listUsersSchema = z.object({
  cursor: optionalFromQueryParam(z.string().uuid()),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: optionalFromQueryParam(z.string().max(200)),
  // `optionalFromQueryParam`, not a bare `.optional()` — the directory's
  // own `<select name="status">` submits `status=` (empty string, not an
  // absent key) for its unselected "Any status" option; a bare
  // `z.enum([...]).optional()` rejects `""` as an invalid enum value
  // instead of treating it as "no filter," crashing the whole page the
  // moment a user submits the filter form with nothing chosen — found by
  // actually clicking through this exact form in a real browser (a
  // Playwright E2E run against a production build), not by inspection.
  // See `lib/validation/parse.ts`'s own doc comment for the full story.
  status: optionalFromQueryParam(z.enum(["INVITED", "ACTIVE", "SUSPENDED", "DEACTIVATED"])),
  emailVerified: optionalFromQueryParam(z.coerce.boolean()),
});

/** The platform-wide user directory (spec section 1) — `users.read`. Cursor-paginated; see `user-repository.ts:search()`'s own doc comment for why this doesn't support arbitrary column sort. */
export async function listUsers(rawInput: unknown): Promise<CursorPaginatedResult<User>> {
  await requirePermission("users.read");
  const input = parseOrThrow(listUsersSchema, rawInput);
  return userRepository.search(
    { cursor: input.cursor, limit: input.limit },
    { search: input.search, status: input.status, emailVerified: input.emailVerified },
  );
}

export interface UserDetail {
  user: User;
  memberships: Awaited<ReturnType<typeof membershipRepository.listForUser>>;
  sessions: Awaited<ReturnType<typeof sessionRepository.listActiveForUser>>;
  invitations: Awaited<ReturnType<typeof invitationRepository.listByEmail>>;
  recentActivity: Awaited<ReturnType<typeof listRecentUserActivity>>;
}

const userIdSchema = z.object({ userId: z.string().uuid() });

/**
 * The global user-detail view (spec section 2) — `users.read`. Composes
 * FOUR read-only sources, never a new query system:
 *
 *   - `membershipRepository.listForUser()` (Module 04/06) — every
 *     organization this person belongs to, with role/status.
 *   - `sessionRepository.listActiveForUser()` (Module 04) — active
 *     sessions; no secrets on this row to accidentally expose (see
 *     `UserSession`'s own schema — no token/secret column exists).
 *   - `invitationRepository.listByEmail()` (Module 10, above) — this
 *     person's cross-org invitation history.
 *   - Recent PLATFORM-scope audit activity (see `listRecentUserActivity`
 *     below) — deliberately NOT every organization-scoped audit event
 *     about this person; see that function's own comment for why
 *     (spec section 30's own adversarial question: "can platform
 *     operations accidentally expose customer data").
 */
export async function getUserDetail(rawInput: unknown): Promise<UserDetail> {
  await requirePermission("users.read");
  const input = parseOrThrow(userIdSchema, rawInput);

  const user = await userRepository.findById(input.userId);
  if (!user) throw new NotFoundError("User");

  const [memberships, sessions, invitations, recentActivity] = await Promise.all([
    membershipRepository.listForUser(user.id),
    sessionRepository.listActiveForUser(user.id),
    invitationRepository.listByEmail(user.email),
    listRecentUserActivity(user.id),
  ]);

  return { user, memberships, sessions, invitations, recentActivity };
}

/**
 * PLATFORM-scope-only activity — `auth.login.success`, `auth.logout`,
 * `profile.updated`, `auth.session.revoked`, `user.*` — every one of
 * which is recorded with `organizationId: NULL` (pre-tenant/global, same
 * category as `AuditEvent.organizationId`'s own established meaning).
 * Deliberately does NOT include `organization.member.*` events from
 * every organization this person belongs to: those are that
 * ORGANIZATION's own audit trail (`audit.read`/`audit.readPlatform`'s
 * own strict separation — see `audit-security.md` "Platform vs.
 * organization audit," which explicitly forbids `audit.readPlatform`
 * from ever substituting for a specific customer organization's own
 * trail). Showing them here — to a platform admin who may hold
 * `users.read` without holding `audit.read` in every one of this
 * person's organizations — would be exactly that leak. An admin
 * investigating a specific organization's own activity for this person
 * goes to that organization's own `/organizations/{id}/audit`, linked
 * from the membership panel instead.
 */
async function listRecentUserActivity(userId: string) {
  return withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) =>
    tx.auditEvent.findMany({
      where: { organizationId: null, OR: [{ actorUserId: userId }, { resourceType: "user", resourceId: userId }] },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  );
}

// --- Create -------------------------------------------------------------

const createPlatformUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  roleId: z.string().uuid(),
});

/**
 * Creates a bare platform-staff identity (spec section 3) — the ONE
 * capability the invitation system structurally cannot provide:
 * `createInvitation()` (`invitation-service.ts`) explicitly rejects
 * `role.scope !== "ORGANIZATION"`, so there was previously no runtime
 * path at all for a human (only `prisma/seed-rbac.ts`, a dev-only
 * script) to become platform staff. `users.create` — reserved
 * specifically for this since Module 05 — is what gates it.
 *
 * Never accepts `organizationId`/`isPlatformStaff` from the client (spec
 * section 3's own explicit prohibition) — the platform organization is
 * always resolved server-side via `findPlatformOrganization()`, and
 * `roleId` is independently validated to be a PLATFORM-scope SYSTEM role
 * (custom platform roles don't exist structurally — see `role-service.ts`'s
 * `createCustomRole()`, which hardcodes `scope: "ORGANIZATION"`).
 *
 * Credential handling: creates a `UserCredential` with an unusable,
 * randomly-generated placeholder hash (never derived from anything
 * guessable), then immediately issues a real `PASSWORD_RESET` token via
 * the EXACT SAME primitives `password-reset-service.ts` uses — this new
 * user literally cannot authenticate until they consume that token
 * through the existing, unmodified `resetPassword()` flow. Zero changes
 * to Module 04's own password-reset code.
 */
export async function createPlatformUser(rawInput: unknown): Promise<User> {
  const context = await requirePermission("users.create");
  const input = parseOrThrow(createPlatformUserSchema, rawInput);

  const email = normalizeEmail(input.email);
  const existing = await userRepository.findByEmail(email);
  if (existing) {
    throw new ConflictError("An account with this email already exists.", { details: { field: "email" } });
  }

  const role = await roleRepository.findById(input.roleId);
  if (!role) throw new NotFoundError("Role");
  if (role.scope !== "PLATFORM") {
    throw new ValidationError("Only platform-scope roles can be granted through platform user creation.");
  }
  if (!role.isSystem) {
    // Structurally unreachable today (no custom PLATFORM-scope role can
    // exist — `createCustomRole()` hardcodes `scope: "ORGANIZATION"`),
    // asserted explicitly rather than silently assumed, per this
    // codebase's own "never trust an invariant you didn't check" style.
    throw new ValidationError("Only system roles can be granted through platform user creation.");
  }

  const platformOrg = await organizationRepository.findPlatformOrganization();
  if (!platformOrg) throw new NotFoundError("Platform organization");

  const unusablePasswordHash = await hashPassword(generateRawToken());

  const created = await withTenantContext(
    { userId: context.user!.id, organizationId: platformOrg.id, isPlatformStaff: true },
    async (tx) => {
      const user = await userRepository.create({ id: generateId(), email, name: input.name }, tx);
      await credentialRepository.create({ id: generateId(), userId: user.id, passwordHash: unusablePasswordHash }, tx);

      const membership = await membershipRepository.create({ id: generateId(), organizationId: platformOrg.id, userId: user.id, role: role.key }, tx);
      await membershipRepository.updateRoleAssignment(membership.id, { role: role.key, roleId: role.id }, tx);

      await audit.recordSuccess({
        action: "user.created",
        resourceType: "user",
        resourceId: user.id,
        resourceName: user.name,
        newState: { email: user.email, name: user.name, platformRole: role.key },
        tx,
      });

      return user;
    },
  );

  const rawToken = generateRawToken();
  await authTokenRepository.create({
    id: generateId(),
    userId: created.id,
    purpose: "PASSWORD_RESET",
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour — same TTL as password-reset-service.ts's own token.
  });
  await sendWelcomeEmail(created.email, created.name, `${appConfig.url}/reset-password?token=${rawToken}`);

  logger.info("Platform user created.", { operation: "user.create", userId: created.id, roleKey: role.key });
  await events.emit("UserCreated", { userId: created.id, email: created.email, platformRoleKey: role.key });

  return created;
}

// --- Edit -----------------------------------------------------------------

const updateUserSchema = z.object({ userId: z.string().uuid(), name: z.string().min(1).max(200) });

/**
 * Admin edit of ANOTHER user's profile (spec section 4) — `users.update`.
 * Deliberately as narrow as `updateOwnProfile()` (Module 07): `name`
 * only. Never `email`/`status`/role/membership — those go through their
 * own dedicated, independently-authorized paths (`suspendUser()`/
 * `reactivateUser()`/`deactivateUser()` below, or `assignRole()`/
 * `membership-service.ts` for role/membership), exactly the separation
 * spec section 4 itself requires ("do not allow a normal profile-edit
 * operation to modify authorization").
 */
export async function updateUserProfile(rawInput: unknown): Promise<User> {
  await requirePermission("users.update");
  const input = parseOrThrow(updateUserSchema, rawInput);

  const target = await userRepository.findById(input.userId);
  if (!target) throw new NotFoundError("User");

  const updated = await userRepository.updateProfile(input.userId, { name: input.name });

  await audit.recordSuccess({
    action: "user.updated",
    resourceType: "user",
    resourceId: target.id,
    resourceName: updated.name,
    previousState: { name: target.name },
    newState: { name: updated.name },
  }).catch((error) => console.error("[audit] failed to record user.updated", error));

  logger.info("User profile updated by admin.", { operation: "user.update", userId: target.id });
  return updated;
}

// --- Lifecycle --------------------------------------------------------

const targetUserSchema = z.object({ userId: z.string().uuid() });

/** True if `userId` currently holds the platform's only ACTIVE `platform_owner` membership — the platform-level analog of `role-service.ts`'s `wouldRemoveLastOwner()`, reusing the same `countActiveByRole()` primitive rather than a second implementation. */
async function isLastActivePlatformOwner(userId: string): Promise<boolean> {
  const platformOrg = await organizationRepository.findPlatformOrganization();
  if (!platformOrg) return false;

  const membership = await membershipRepository.findByOrganizationAndUser(platformOrg.id, userId);
  if (!membership || membership.role !== "platform_owner" || membership.status !== "ACTIVE") return false;

  const count = await membershipRepository.countActiveByRole(platformOrg.id, "platform_owner");
  return count <= 1;
}

/**
 * Suspend/reactivate/deactivate share this one gate (spec sections 5/6/7 —
 * "protect platform owner/system accounts," "prevent inappropriate
 * self-suspension"), checked identically regardless of which transition
 * is being attempted, so there's exactly one place this policy lives.
 */
async function assertMutableAccount(callerId: string, target: User, action: "suspend" | "deactivate"): Promise<void> {
  if (target.id === callerId) {
    throw new ValidationError(`You cannot ${action} your own account. Ask another platform administrator.`);
  }
  if (await isLastActivePlatformOwner(target.id)) {
    throw new ConflictError("This is the platform's last active owner — assign another platform owner first.", {
      details: { reason: "last_platform_owner" },
    });
  }
}

async function requireIdentity() {
  const identity = await getCurrentUser();
  if (!identity) throw new AuthenticationError();
  return identity;
}

/**
 * ACTIVE → SUSPENDED (spec section 5). `users.update` — a lesser action
 * than deactivation (below), gated by the lesser permission. Immediately
 * effective on two independent layers: `User.status` (checked by
 * `getCurrentUser()` on every subsequent request — a suspended user's
 * NEXT page load already fails, with no session-table lookup involved
 * at all) AND every currently-live `UserSession` row is explicitly
 * revoked (defense-in-depth, and what makes `/settings/sessions`'s own
 * list immediately reflect "revoked by admin" rather than silently
 * going stale — spec section 5's own "do not rely on stale client
 * state").
 */
export async function suspendUser(rawInput: unknown): Promise<void> {
  const identity = await requireIdentity();
  await requirePermission("users.update");
  const input = parseOrThrow(targetUserSchema, rawInput);

  const target = await userRepository.findById(input.userId);
  if (!target) throw new NotFoundError("User");
  if (target.status !== "ACTIVE") {
    throw new ConflictError("Only an active account can be suspended.");
  }
  await assertMutableAccount(identity.user.id, target, "suspend");

  await userRepository.updateStatus(target.id, "SUSPENDED");
  const revokedCount = await sessionService.revokeAllSessions(target.id, "admin_suspended");

  await recordLifecycleAudit("user.suspended", target, { status: "SUSPENDED" }, { revokedSessions: revokedCount });
  logger.info("User suspended.", { operation: "user.suspend", userId: target.id, revokedSessions: revokedCount });
  await events.emit("UserSuspended", { userId: target.id });
}

/**
 * SUSPENDED|DEACTIVATED → ACTIVE (spec section 6). The required
 * permission depends on the CURRENT state, not a single fixed
 * permission — reactivating from `DEACTIVATED` requires the same
 * privilege level (`users.delete`) that deactivation itself needed,
 * symmetric with how it got there; reactivating from `SUSPENDED` only
 * needs `users.update`, the same lesser permission that suspended it.
 * "Restore only the intended capability" (spec's own wording) — this
 * function restores `User.status` alone; it never touches any
 * `OrganizationMembership` (a membership suspended independently, via
 * `membership-service.ts`, stays exactly as it was — see
 * `docs/architecture/user-lifecycle.md` "Global status vs. membership
 * status are never coupled").
 */
export async function reactivateUser(rawInput: unknown): Promise<void> {
  await requireIdentity();
  const input = parseOrThrow(targetUserSchema, rawInput);

  const target = await userRepository.findById(input.userId);
  if (!target) throw new NotFoundError("User");
  if (target.status !== "SUSPENDED" && target.status !== "DEACTIVATED") {
    throw new ConflictError("Only a suspended or deactivated account can be reactivated.");
  }

  await requirePermission(target.status === "DEACTIVATED" ? "users.delete" : "users.update");

  const previousStatus = target.status;
  await userRepository.updateStatus(target.id, "ACTIVE");

  await recordLifecycleAudit("user.reactivated", target, { status: "ACTIVE" }, { previousStatus });
  logger.info("User reactivated.", { operation: "user.reactivate", userId: target.id, previousStatus });
  await events.emit("UserReactivated", { userId: target.id, previousStatus });
}

/**
 * ACTIVE|SUSPENDED → DEACTIVATED (spec section 7) — `users.delete`, the
 * platform's own documented meaning for that permission ("Deactivate a
 * platform user... users are never hard-deleted"). Same two-layer
 * immediate-effect and last-owner/self-protection as `suspendUser()`.
 * The `User` row, every historical `OrganizationMembership`, and every
 * `AuditEvent` referencing this person are all UNCHANGED by this
 * function — deactivation is a status flip, never a deletion, exactly
 * spec section 7's own instruction ("do not hard-delete identity
 * records") and `data-modeling.md`'s existing "Deletion strategy."
 */
export async function deactivateUser(rawInput: unknown): Promise<void> {
  const identity = await requireIdentity();
  await requirePermission("users.delete");
  const input = parseOrThrow(targetUserSchema, rawInput);

  const target = await userRepository.findById(input.userId);
  if (!target) throw new NotFoundError("User");
  if (target.status === "DEACTIVATED") {
    throw new ConflictError("This account is already deactivated.");
  }
  await assertMutableAccount(identity.user.id, target, "deactivate");

  const previousStatus = target.status;
  await userRepository.updateStatus(target.id, "DEACTIVATED");
  const revokedCount = await sessionService.revokeAllSessions(target.id, "admin_deactivated");

  await recordLifecycleAudit("user.deactivated", target, { status: "DEACTIVATED" }, { previousStatus, revokedSessions: revokedCount });
  logger.info("User deactivated.", { operation: "user.deactivate", userId: target.id, revokedSessions: revokedCount });
  await events.emit("UserDeactivated", { userId: target.id });
}

async function recordLifecycleAudit(
  action: "user.suspended" | "user.reactivated" | "user.deactivated",
  target: User,
  newState: Record<string, unknown>,
  metadata: Record<string, unknown>,
): Promise<void> {
  await audit
    .recordSuccess({
      action,
      resourceType: "user",
      resourceId: target.id,
      resourceName: target.name,
      previousState: { status: target.status },
      newState,
      metadata,
    })
    .catch((error) => console.error(`[audit] failed to record ${action}`, error));
}

// --- Sessions (admin) ---------------------------------------------------

const revokeUserSessionSchema = z.object({ userId: z.string().uuid(), sessionId: z.string().uuid() });

/**
 * Admin revokes ANOTHER user's specific session (spec section 11) —
 * `users.update`, same permission profile-editing needs (a session
 * revocation is a lesser action than a full account suspension). Reuses
 * `sessionService.revokeOwnSession()`'s ownership check verbatim — a
 * `sessionId` that doesn't belong to `userId` (forged, or copy-pasted
 * from a different user's own detail page) throws `NotFoundError`, the
 * same enumeration-safe shape as every other IDOR-sensitive lookup here.
 */
export async function revokeUserSession(rawInput: unknown): Promise<void> {
  await requirePermission("users.update");
  const input = parseOrThrow(revokeUserSessionSchema, rawInput);

  const target = await userRepository.findById(input.userId);
  if (!target) throw new NotFoundError("User");

  await sessionService.revokeOwnSession(input.sessionId, input.userId, "admin_revoked");

  await audit
    .recordSuccess({ action: "auth.session.revoked", resourceType: "user", resourceId: target.id, resourceName: target.name, metadata: { reason: "admin_revoked", sessionId: input.sessionId } })
    .catch((error) => console.error("[audit] failed to record auth.session.revoked", error));

  logger.info("Session revoked by admin.", { operation: "session.adminRevoke", userId: target.id, sessionId: input.sessionId });
}
