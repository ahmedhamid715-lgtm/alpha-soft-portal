import "server-only";
import Stripe from "stripe";
import { serverEnv, isStripeConfigured } from "@/config/environment";
import { ExternalServiceError } from "@/lib/errors/app-error";

/**
 * The Stripe SDK client — instantiated ONCE, from `serverEnv` (spec §16:
 * "Environment configuration must use the existing Module 01
 * configuration architecture"), never `process.env` directly. Imported
 * ONLY by files under `provider/stripe/` — see `provider/interface.ts`'s
 * own top comment for why nothing else in the codebase should import
 * `stripe` at all.
 */
let cachedClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!isStripeConfigured) {
    // A clear, safe failure rather than the SDK's own less-obvious error
    // (spec §42: map provider errors into safe domain errors) — this is
    // the one place `isStripeConfigured` gates every real Stripe call in
    // the codebase.
    throw new ExternalServiceError("Stripe");
  }
  if (!cachedClient) {
    cachedClient = new Stripe(serverEnv.STRIPE_SECRET_KEY!, {
      typescript: true,
    });
  }
  return cachedClient;
}
