import "server-only";
import { sessionRepository } from "@/server/repositories/session-repository";
import { NotFoundError } from "@/lib/errors/app-error";
import type { UserSession } from "@/generated/prisma/client";

/**
 * Session revocation (spec section 9) — the operations that make
 * "logout," "logout everywhere," "revoke after password reset," and (a
 * future admin surface, not built here) "revoke a compromised session"
 * possible. None of these touch the JWT itself — they mark the
 * corresponding `UserSession` row revoked, and `requireAuthenticatedUser()`
 * (`lib/auth/session-guard.ts`) is what actually enforces that a revoked
 * row means "not authenticated," regardless of what the still-valid-by-
 * signature JWT claims.
 *
 * `revokeSession()`/`revokeAllSessions()` are raw, UNAUTHORIZED
 * primitives — every existing caller (`password-reset-service.ts`) has
 * already independently resolved who's allowed to call them before
 * reaching here. Module 10 (User Management) is the first caller that
 * needs to expose session revocation to end users directly — for THAT,
 * see `revokeOwnSession()` below, which adds the ownership check no
 * previous caller needed, rather than trusting a new caller to remember
 * to add it themselves.
 */
export const sessionService = {
  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await sessionRepository.revoke(sessionId, reason);
  },

  /** "Logout everywhere" — every live session for this user, optionally sparing the one making the current request (a user revoking every *other* session without logging themselves out). */
  async revokeAllSessions(userId: string, reason: string, exceptSessionId?: string): Promise<number> {
    return sessionRepository.revokeAllForUser(userId, reason, exceptSessionId);
  },

  async listActiveSessions(userId: string): Promise<UserSession[]> {
    return sessionRepository.listActiveForUser(userId);
  },

  /**
   * Module 10 — the self-service "revoke this device" primitive
   * (`/settings/sessions`) AND the admin-on-another-user primitive
   * (`user-management-service.ts:revokeUserSession()`), which is why
   * `ownerUserId` is a parameter rather than always `getCurrentUser()`:
   * an admin's session-management action legitimately targets someone
   * else's `userId`, but the OWNERSHIP check below is identical either
   * way — a session id that doesn't belong to `ownerUserId` throws
   * `NotFoundError`, never revokes a different person's session (spec
   * section 14: "sessionId forgery" — a forged/guessed sessionId for
   * someone else's device is structurally indistinguishable from a
   * nonexistent one, same enumeration-avoidance discipline every other
   * IDOR-sensitive lookup in this codebase follows).
   */
  async revokeOwnSession(sessionId: string, ownerUserId: string, reason: string): Promise<void> {
    const session = await sessionRepository.findById(sessionId);
    if (!session || session.userId !== ownerUserId) {
      throw new NotFoundError("Session");
    }
    await sessionRepository.revoke(sessionId, reason);
  },
};
