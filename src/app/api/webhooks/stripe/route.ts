import { createRouteHandler } from "@/lib/platform/route-handler";
import { apiSuccess } from "@/lib/errors/api-response";
import { ValidationError } from "@/lib/errors/app-error";
import { verifyStripeWebhookSignature } from "@/lib/billing/provider/stripe/webhook";
import { processStripeWebhookEvent } from "@/server/services/billing-webhook-service";

/**
 * `POST /api/webhooks/stripe` (spec §17) — the ONLY entrypoint through
 * which an external Stripe event can change Alpha OS billing state. No
 * authentication, no session, no cookie — a webhook has none of those;
 * `Stripe-Signature` verification (spec §20) IS this route's entire
 * authorization boundary, and it's checked before a single byte of the
 * body is treated as trustworthy.
 *
 * `request.text()`, never `request.json()` — signature verification
 * requires the EXACT raw bytes Stripe signed; re-serializing a parsed
 * JSON object would produce a byte-for-byte different string (different
 * key order, whitespace, number formatting) and every signature would
 * fail. This is the one Route Handler in the codebase that cannot use
 * `request.json()` at all, for exactly this reason.
 *
 * Status codes ARE the retry contract with Stripe (spec §49): a 4xx
 * (bad signature, malformed body) tells Stripe "do not retry, this
 * request is wrong"; a 5xx (a genuine processing failure inside
 * `processStripeWebhookEvent()`) tells Stripe "retry later" — Stripe's
 * own automatic exponential-backoff retry (up to several days) is this
 * module's retry mechanism (spec §49's own "do not implement an
 * in-process infinite retry loop. Use the future job infrastructure
 * boundary" — for webhook delivery specifically, that boundary is
 * Stripe's own retry queue, not a queue Alpha OS has to build). Both
 * codes fall out of the existing `createRouteHandler`/`apiError()`
 * architecture automatically — `ValidationError` (signature failure) is
 * already mapped to 400, and any other thrown error is already mapped
 * to 500 (`toAppError()`'s `InternalServerError` fallback) — nothing
 * webhook-specific needed to add here.
 */
export const dynamic = "force-dynamic";

export const POST = createRouteHandler(async (request) => {
  const signatureHeader = request.headers.get("stripe-signature");
  if (!signatureHeader) {
    throw new ValidationError("Missing Stripe-Signature header.");
  }

  const rawBody = await request.text();
  const event = await verifyStripeWebhookSignature(rawBody, signatureHeader);

  const result = await processStripeWebhookEvent(event);
  return apiSuccess({ received: true, outcome: result.outcome });
});
