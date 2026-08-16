import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { serverEnv } from "@/config/environment";
import { logger } from "@/lib/logging";

/**
 * A SEPARATE Prisma Client, connected via `APP_DATABASE_URL` — the
 * restricted, non-superuser, non-table-owning Postgres role Row-Level
 * Security actually applies to. See `docs/architecture/rls.md` "The
 * restricted role" for exactly why this must be a distinct connection
 * from `@/lib/db/client`'s `db` singleton, not a config toggle on it:
 * `db` is used throughout Modules 01–05 for work that predates RLS and
 * is not tenant-context-aware (migrations, health checks, Module 04's
 * own session/credential lookups, which must keep working exactly as
 * built) — forcing all of that onto a role that can't see anything
 * without a transaction-local tenant context set first would break it.
 * `tenantDb` is used exclusively by `withTenantContext()` below.
 *
 * Falls back to `serverEnv.DATABASE_URL` (logging a warning once) if
 * `APP_DATABASE_URL` isn't configured — so a fresh checkout that hasn't
 * provisioned the restricted role yet still runs. This fallback means
 * RLS provides NO real protection in that state (the fallback role is
 * whatever `DATABASE_URL` connects as, typically a superuser/owner that
 * bypasses RLS) — this is the intended, documented degrade path for a
 * dev environment, not something a real deployment should ever rely on.
 * `isTenantRoleConfigured` lets tests/health checks assert the real role
 * is actually in effect rather than silently trusting the fallback.
 */

const FALLBACK_CONNECTION_STRING = "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export const isTenantRoleConfigured = Boolean(serverEnv.APP_DATABASE_URL);

if (!isTenantRoleConfigured && serverEnv.DATABASE_URL) {
  logger.warn(
    "APP_DATABASE_URL is not set — tenant-scoped queries will run through DATABASE_URL's role. If that role is a superuser or owns the RLS-protected tables, Row-Level Security provides no real protection. See docs/architecture/rls.md.",
    { operation: "tenancy.client.init" },
  );
}

const globalForTenantPrisma = globalThis as unknown as { __alphaOsTenantPrisma?: PrismaClient };

function createTenantPrismaClient(): PrismaClient {
  const connectionString = serverEnv.APP_DATABASE_URL ?? serverEnv.DATABASE_URL ?? FALLBACK_CONNECTION_STRING;
  const adapter = new PrismaPg({ connectionString, options: "-c timezone=UTC" });
  return new PrismaClient({
    adapter,
    log: serverEnv.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/** The restricted-role Prisma Client — never query this directly; go through `withTenantContext()` (`context.ts` in this directory) so the transaction-local `app.*` settings are always established first. */
export const tenantDb: PrismaClient = globalForTenantPrisma.__alphaOsTenantPrisma ?? createTenantPrismaClient();

if (serverEnv.NODE_ENV !== "production") {
  globalForTenantPrisma.__alphaOsTenantPrisma = tenantDb;
}
