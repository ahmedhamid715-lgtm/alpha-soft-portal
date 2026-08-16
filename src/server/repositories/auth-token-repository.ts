import "server-only";
import type { AuthToken, AuthTokenPurpose } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";

/**
 * Data access for `AuthToken` — email verification and password reset
 * tokens. Every lookup is by `tokenHash` (never a raw token — see
 * `lib/auth/tokens.ts`), and every consumption check happens in
 * application code (`consumedAt`/`expiresAt`), not as a database
 * constraint, since "reject an already-used or expired token with a
 * specific, safe error" is a business rule, not a data-integrity one.
 */
export const authTokenRepository = {
  async create(input: {
    id: string;
    userId: string;
    purpose: AuthTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<AuthToken> {
    return withDbErrorTranslation(() =>
      db.authToken.create({
        data: {
          id: input.id,
          userId: input.userId,
          purpose: input.purpose,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        },
      }),
    );
  },

  async findByTokenHash(tokenHash: string): Promise<AuthToken | null> {
    return withDbErrorTranslation(() => db.authToken.findUnique({ where: { tokenHash } }));
  },

  async markConsumed(id: string): Promise<AuthToken> {
    return withDbErrorTranslation(() => db.authToken.update({ where: { id }, data: { consumedAt: new Date() } }));
  },

  /** Invalidate any earlier live tokens of the same purpose before issuing a new one — a user requesting a second reset email shouldn't leave the first link live too. */
  async invalidateLiveForUser(userId: string, purpose: AuthTokenPurpose): Promise<void> {
    await withDbErrorTranslation(() =>
      db.authToken.updateMany({
        where: { userId, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
    );
  },
};
