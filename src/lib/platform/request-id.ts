import { randomUUID } from "node:crypto";

/**
 * Request correlation IDs (spec section 16).
 *
 * Every meaningful server request gets an ID that's generated if absent,
 * echoed back in API error responses, and threaded through structured
 * logs — so a single customer-reported failure can be traced across
 * "API → database → background job → AI → external integration" without
 * guessing which log lines belong together.
 */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Reuse an incoming `x-request-id` if the caller (a load balancer, another
 * internal service, a retried client request) already supplied one and it
 * looks safe to log/echo verbatim; otherwise mint a fresh UUID.
 */
export function getOrCreateRequestId(request: Request): string {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  if (incoming && isValidRequestId(incoming)) {
    return incoming;
  }
  return randomUUID();
}

function isValidRequestId(value: string): boolean {
  // Bounded length + restricted character set so a client can't smuggle
  // arbitrary content into log lines or response headers via this header.
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._-]+$/.test(value);
}
