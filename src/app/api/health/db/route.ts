import { createRouteHandler } from "@/lib/platform/route-handler";
import { apiSuccess } from "@/lib/errors/api-response";
import { checkDatabaseHealth } from "@/lib/db/health";

/**
 * Database dependency health check (spec section 35). Distinguishes
 * healthy / degraded / unavailable rather than a bare boolean, so an
 * uptime monitor or dashboard can tell "slow" apart from "down."
 *
 * Maps to HTTP status so infrastructure that only understands status
 * codes (load balancers, simple uptime checks) still behaves correctly:
 * healthy/degraded → 200 (the app is up; degraded is a signal, not an
 * outage), unavailable → 503.
 */
export const dynamic = "force-dynamic";

export const GET = createRouteHandler(async () => {
  const result = await checkDatabaseHealth();
  const httpStatus = result.status === "unavailable" ? 503 : 200;

  return apiSuccess(result, httpStatus);
});
