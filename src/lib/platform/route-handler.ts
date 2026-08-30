import "server-only";
import type { NextRequest } from "next/server";
import { logger } from "@/lib/logging";
import { apiError } from "@/lib/errors/api-response";
import { getOrCreateRequestId, REQUEST_ID_HEADER } from "./request-id";

/**
 * The API architecture convention every Route Handler should be built on
 * (spec section 27): request ID, structured logging, and consistent error
 * handling for free, so individual routes only implement their own logic.
 *
 * What this wrapper does NOT do — by design, since none of it exists yet
 * in Module 01 — is authorization or rate limiting. Those are *hooks*:
 * call `rateLimiter.check(...)` (lib/platform/rate-limit.ts) and whatever
 * Module 05 (Authorization & RBAC) provides at the top of your handler
 * function, before touching data. Input validation is likewise the
 * handler's job via `parseOrThrow` (lib/validation/parse.ts) — this
 * wrapper only guarantees that whatever you throw comes out the other end
 * as a correctly-shaped, correctly-logged API error response.
 *
 * Usage:
 *   export const GET = createRouteHandler(async (request, { requestId }) => {
 *     const data = await doSomething();
 *     return apiSuccess(data);
 *   });
 *
 * Dynamic route segments (`[id]`): Next calls the exported `GET`/`POST`/…
 * with a second argument, `{ params: Promise<Record<string, string>> }`
 * — this wrapper forwards it through unchanged as `ctx.params` (Module
 * 08's audit CSV export routes are the first real consumer). Routes with
 * no dynamic segment simply never destructure it, same as before this
 * existed.
 */
export function createRouteHandler<TParams = Record<string, string>>(
  handler: (request: NextRequest, ctx: { requestId: string; params: Promise<TParams> }) => Promise<Response>,
) {
  return async (request: NextRequest, routeContext: { params: Promise<TParams> }): Promise<Response> => {
    const requestId = getOrCreateRequestId(request);
    const requestLogger = logger.child({
      requestId,
      operation: "http.request",
      method: request.method,
      path: request.nextUrl.pathname,
    });

    try {
      const response = await handler(request, {
        requestId,
        params: routeContext.params,
      });
      response.headers.set(REQUEST_ID_HEADER, requestId);
      return response;
    } catch (error) {
      requestLogger.error("Unhandled error in route handler.", {
        error: error instanceof Error ? error.message : String(error),
      });
      const response = apiError(error, requestId);
      response.headers.set(REQUEST_ID_HEADER, requestId);
      return response;
    }
  };
}
