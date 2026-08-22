import "server-only";
import type Stripe from "stripe";
import { serverEnv } from "@/config/environment";
import { getStripeClient } from "./client";
import { ValidationError } from "@/lib/errors/app-error";

/**
 * Signature verification (spec §17/§20) — the ONE gate every byte of an
 * incoming webhook request passes through before anything in this
 * codebase treats it as real. `stripe.webhooks.constructEventAsync()`
 * verifies the `Stripe-Signature` header against the RAW request body
 * (never `request.json()` — see `app/api/webhooks/stripe/route.ts`'s own
 * comment for why the raw-body requirement shapes that route handler)
 * using `STRIPE_WEBHOOK_SECRET`, and throws
 * `Stripe.errors.StripeSignatureVerificationError` on any mismatch —
 * translated here into a safe `ValidationError` so the route handler
 * never has to import a Stripe error type itself.
 */
export async function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string): Promise<Stripe.Event> {
  if (!serverEnv.STRIPE_WEBHOOK_SECRET) {
    // Fails closed — an unconfigured secret must never fall back to
    // "trust the request," even in development (spec §20: "reject
    // malformed signatures").
    throw new ValidationError("Webhook signature verification is not configured.");
  }
  const stripe = getStripeClient();
  try {
    return await stripe.webhooks.constructEventAsync(rawBody, signatureHeader, serverEnv.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    // Never rethrow the raw Stripe error — its message can include
    // header/body excerpts we don't want in a client-facing response
    // (spec §20/§42). The route handler logs the real cause separately
    // (`logger.warn`, not exposed to the response body).
    throw new ValidationError("Invalid webhook signature.", { cause: error });
  }
}
