import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { serverEnv, isDatabaseConfigured } from "@/config/environment";

/**
 * Prisma singleton (spec section 12).
 *
 * Two things this guards against:
 *
 *   1. Next.js dev-mode hot reload re-evaluating this module on every
 *      edit, which would otherwise construct a fresh PrismaClient (and a
 *      fresh connection pool) per reload and exhaust Postgres connections
 *      within minutes of active development. Caching the instance on
 *      `globalThis` outside production survives hot reload.
 *   2. Constructing the client at all when `DATABASE_URL` isn't set. The
 *      client is still created (with a placeholder connection string,
 *      matching prisma.config.ts's fallback) so importing this module
 *      never crashes module evaluation — only an actual query will fail,
 *      which lib/db/errors.ts translates and /api/health/db reports
 *      cleanly instead of taking the whole app down.
 *
 *   3. **Every connection's session timezone is forced to UTC** via the
 *      `-c timezone=UTC` startup option below. Found by this project's
 *      Module 04 security audit: this Postgres server's cluster default
 *      is the OS timezone (`Asia/Karachi`, UTC+5 — `brew install
 *      postgresql` does not set it), and `pg`'s text-mode `timestamptz`
 *      parser reads the wall-clock digits Postgres sends back *in that
 *      session timezone* without re-deriving true UTC from them — so
 *      every `TIMESTAMPTZ` column (session `expiresAt`, token
 *      `expiresAt`, `createdAt`/`updatedAt`, everything) was silently
 *      read back offset by the server's UTC delta. This surfaced when a
 *      deliberately-expired `UserSession` (`expiresAt` forced into the
 *      past) still compared as "in the future" against `Date.now()`,
 *      because it had been read back 5 hours later than its true UTC
 *      instant. Storage was never wrong (Postgres stores `timestamptz`
 *      as a true UTC instant internally) — only the read path was.
 *      Forcing the session timezone at the connection level fixes this
 *      regardless of the server's cluster-wide default, so a future
 *      environment that also forgets to configure UTC server-side
 *      doesn't reintroduce this.
 */

const FALLBACK_CONNECTION_STRING =
  "postgresql://placeholder:placeholder@localhost:5432/placeholder";

const globalForPrisma = globalThis as unknown as { __alphaOsPrisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: serverEnv.DATABASE_URL ?? FALLBACK_CONNECTION_STRING,
    options: "-c timezone=UTC",
  });

  return new PrismaClient({
    adapter,
    log: serverEnv.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const db: PrismaClient = globalForPrisma.__alphaOsPrisma ?? createPrismaClient();

if (serverEnv.NODE_ENV !== "production") {
  globalForPrisma.__alphaOsPrisma = db;
}

export { isDatabaseConfigured };
