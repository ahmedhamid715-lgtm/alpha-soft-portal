import { describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { sessionRepository } from "@/server/repositories/session-repository";

/**
 * Regression test for a real bug found by this project's Module 04
 * security audit: this Postgres server's cluster-default session
 * timezone is not UTC (locally, `Asia/Karachi`), and reading a
 * `TIMESTAMPTZ` value back through `@prisma/adapter-pg` without forcing
 * the connection's session timezone produced a JS `Date` shifted by the
 * server's UTC offset — e.g. a session `expiresAt` forced into the past
 * (`now() - 1 minute`) still compared as ~5 hours in the *future*
 * against `Date.now()`, so an expired session was silently treated as
 * still valid. Fixed in `src/lib/db/client.ts` by passing
 * `options: "-c timezone=UTC"` to the underlying `pg.Pool`. This test
 * exists so a future change to that file (or a driver upgrade that
 * changes the default) regresses loudly instead of silently — it does
 * not depend on the local server's misconfigured default to be
 * meaningful; it proves round-trip fidelity against whatever timezone
 * the connection is actually in.
 */
describe.skipIf(!isDatabaseConfigured)("DB connection timezone integrity", () => {
  it("session timezone is forced to UTC regardless of the server's cluster default", async () => {
    const rows = await db.$queryRawUnsafe<{ TimeZone: string }[]>("SHOW timezone");
    expect(rows[0]?.TimeZone).toBe("UTC");
  });

  it("a TIMESTAMPTZ forced into the past via raw SQL round-trips as truly in the past through Prisma", async () => {
    const userId = generateId();
    await userRepository.create({ id: userId, email: `tz-audit-${userId}@alpha-os.test`, name: "TZ Audit" });
    try {
      const sessionId = generateId();
      await sessionRepository.create({ id: sessionId, userId, expiresAt: new Date(Date.now() + 60_000) });

      // Mimic real clock skew via a raw SQL write (bypassing Prisma's own
      // Date serialization) so this test exercises the READ path in
      // isolation, the same path `getCurrentUser()` uses.
      await db.$executeRawUnsafe(
        `UPDATE user_sessions SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        sessionId,
      );

      const readBack = await sessionRepository.findById(sessionId);
      expect(readBack).not.toBeNull();
      // The historical bug made this comparison false (expiry appeared
      // hours in the future) instead of true.
      expect(readBack!.expiresAt.getTime()).toBeLessThan(Date.now());
    } finally {
      await db.user.delete({ where: { id: userId } });
    }
  });
});
