import "server-only";
import { db, isDatabaseConfigured } from "./client";

export type DatabaseHealthStatus = "healthy" | "degraded" | "unavailable";

export interface DatabaseHealthResult {
  status: DatabaseHealthStatus;
  latencyMs?: number;
  message?: string;
}

const HEALTH_CHECK_TIMEOUT_MS = 3000;
/** Above this latency the connection works but is slow enough to flag. */
const DEGRADED_LATENCY_THRESHOLD_MS = 1000;

/**
 * Backs `/api/health/db` (spec section 35). Deliberately returns only a
 * status + latency + generic message — never the connection string, host,
 * or raw driver error, since this can be reachable without authentication.
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealthResult> {
  if (!isDatabaseConfigured) {
    return { status: "unavailable", message: "DATABASE_URL is not configured." };
  }

  const start = performance.now();
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Health check timed out.")), HEALTH_CHECK_TIMEOUT_MS)),
    ]);

    const latencyMs = Math.round(performance.now() - start);
    return {
      status: latencyMs > DEGRADED_LATENCY_THRESHOLD_MS ? "degraded" : "healthy",
      latencyMs,
    };
  } catch {
    return { status: "unavailable", message: "Could not reach the database." };
  }
}
