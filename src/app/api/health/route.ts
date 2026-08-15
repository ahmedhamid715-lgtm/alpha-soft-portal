import { createRouteHandler } from "@/lib/platform/route-handler";
import { apiSuccess } from "@/lib/errors/api-response";
import { appConfig } from "@/config/app";

/**
 * Application liveness check (spec section 35). Confirms the Next.js
 * server process is up and can execute a Route Handler — nothing more.
 * For actual dependency health (database, ...), see /api/health/db.
 *
 * Deliberately returns no infrastructure detail beyond environment name —
 * no hostnames, connection strings, versions, or stack traces. Anyone can
 * reach this endpoint unauthenticated (that's the point of a liveness
 * probe), so treat its response as public.
 */
export const dynamic = "force-dynamic";

export const GET = createRouteHandler(async () => {
  return apiSuccess({
    status: "healthy" as const,
    timestamp: new Date().toISOString(),
    environment: appConfig.environment,
  });
});
