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
 */

const FALLBACK_CONNECTION_STRING =
  "postgresql://placeholder:placeholder@localhost:5432/placeholder";

const globalForPrisma = globalThis as unknown as { __alphaOsPrisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: serverEnv.DATABASE_URL ?? FALLBACK_CONNECTION_STRING,
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
