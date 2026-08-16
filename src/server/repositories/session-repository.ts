import "server-only";
import type { UserSession } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";

/**
 * Data access for `UserSession` — this module's own session-tracking
 * table, not Auth.js's adapter-managed `Session` model. See
 * prisma/schema.prisma and docs/architecture/authentication.md "Session
 * strategy" for why this exists at all (Credentials + JWT gives no
 * server-side revocation on its own).
 */
export const sessionRepository = {
  async create(input: {
    id: string;
    userId: string;
    userAgent?: string | null;
    expiresAt: Date;
  }): Promise<UserSession> {
    return withDbErrorTranslation(() =>
      db.userSession.create({
        data: {
          id: input.id,
          userId: input.userId,
          userAgent: input.userAgent ?? null,
          expiresAt: input.expiresAt,
        },
      }),
    );
  },

  async findById(id: string): Promise<UserSession | null> {
    return withDbErrorTranslation(() => db.userSession.findUnique({ where: { id } }));
  },

  /** Only called at most once per `updateAge` window (see auth.ts's `jwt` callback) — not on every request. */
  async touch(id: string): Promise<void> {
    await withDbErrorTranslation(() =>
      db.userSession.update({ where: { id }, data: { lastActiveAt: new Date() } }),
    );
  },

  async revoke(id: string, reason: string): Promise<void> {
    await withDbErrorTranslation(() =>
      db.userSession.update({ where: { id }, data: { revokedAt: new Date(), revokedReason: reason } }),
    );
  },

  /** "Logout everywhere" / "revoke sessions after password reset" — every one of this user's still-live sessions, optionally excluding the one making the current request. */
  async revokeAllForUser(userId: string, reason: string, exceptSessionId?: string): Promise<number> {
    const result = await withDbErrorTranslation(() =>
      db.userSession.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
        },
        data: { revokedAt: new Date(), revokedReason: reason },
      }),
    );
    return result.count;
  },

  async listActiveForUser(userId: string): Promise<UserSession[]> {
    return withDbErrorTranslation(() =>
      db.userSession.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastActiveAt: "desc" },
      }),
    );
  },
};
