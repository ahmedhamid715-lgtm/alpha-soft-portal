import "server-only";
import { sessionRepository } from "@/server/repositories/session-repository";
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
};
