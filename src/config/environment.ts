import "server-only";
import { z } from "zod";

/**
 * Server-side environment configuration.
 *
 * This module is the ONLY place `process.env` should be read directly for
 * server-only values. Everything else in the application should import
 * `serverEnv` from here instead of touching `process.env` directly — that
 * keeps validation, defaults, and typing in one place.
 *
 * Importing `server-only` guarantees a build-time error if this module is
 * ever pulled into a client bundle, even by accident (see
 * docs/architecture/security.md).
 *
 * Variables are grouped by the categories this platform will grow into.
 * A variable being `.optional()` here means Module 1 does not yet depend
 * on it being set — the module that introduces the feature (noted in each
 * comment) is responsible for treating it as required once that feature
 * ships. This lets `npm run dev` boot cleanly on a fresh checkout before
 * every downstream module exists.
 */
const serverEnvSchema = z.object({
  // --- Application ---
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // --- Database (infrastructure: Module 01; entities: Module 03) ---
  // Postgres connection string, consumed by prisma.config.ts and by the
  // pg driver adapter in lib/db. Prisma 7 removed the separate `directUrl`
  // migrations concept — driver adapters handle migrations over the same
  // connection automatically, so only one URL is needed.
  DATABASE_URL: z.string().url().optional(),
  // --- Multi-tenancy / RLS (Module 06) ---
  // A separate, restricted, non-superuser Postgres role RLS actually
  // applies to — see docs/architecture/rls.md "The restricted role."
  // Falls back to DATABASE_URL (with a logged warning) if unset, so a
  // fresh checkout that hasn't provisioned the role yet still runs —
  // just without real RLS enforcement.
  APP_DATABASE_URL: z.string().url().optional(),

  // --- Authentication (Module 04) ---
  // Secret used to sign session tokens. Required once Module 04 lands;
  // must be a high-entropy random string (32+ bytes).
  AUTH_SECRET: z.string().min(32).optional(),

  // --- AI (Module 17 — AI Infrastructure & Intelligence Foundation) ---
  // Claude is the primary provider (see shared/claude-api skill conventions
  // used elsewhere in this project — always the official Anthropic SDK).
  // Reserved by Module 01; claimed by Module 17's real
  // `lib/ai/provider/anthropic/` implementation. The module-numbering
  // ambiguity this comment previously carried ("Module 33 — AI Core")
  // is resolved — Module 17 is the real, authoritative claimant.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_CHAT_MODEL: z.string().min(1).optional(),
  // OpenAI remains a reserved, NOT-yet-implemented secondary provider —
  // still no OpenAI SDK code anywhere in this codebase (see
  // `lib/ai/provider/interface.ts` "Why only one provider is
  // implemented"). Reserved so the env schema doesn't need revisiting
  // when a real second caller justifies it.
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_CHAT_MODEL: z.string().min(1).optional(),

  // --- Email (Module 09 — Notification & Communication Infrastructure) ---
  // Selects the `EmailProvider` implementation (`lib/mail/mailer.ts`).
  // Only "console" has a real implementation today — any other value (or
  // unset) falls back to it with a logged warning rather than throwing at
  // boot; see notifications.md "What was deliberately not built."
  // Provider-specific credentials (a future Resend/Postmark/SES API key)
  // belong here too, server-only, never behind NEXT_PUBLIC_*.
  EMAIL_PROVIDER: z.string().min(1).optional(),
  EMAIL_FROM_ADDRESS: z.string().email().optional(),
  EMAIL_FROM_NAME: z.string().min(1).optional(),

  // --- Billing (Module 13 — Enterprise Billing, Plans & Subscription
  // Infrastructure) — Stripe is the initial provider (spec section 16).
  // Both server-only, NEVER exposed via NEXT_PUBLIC_*: this codebase's
  // Checkout/Billing Portal flows only ever create a session server-side
  // and redirect (see billing-provider.md) — there is no client-side
  // Stripe.js/Elements usage anywhere in this module, so no publishable
  // key is needed at all.
  //
  // Test-mode keys start with `sk_test_`/`whsec_` (from the Stripe
  // dashboard's own test-mode webhook signing secret) — live keys start
  // with `sk_live_`. `isStripeLiveMode` below makes an accidental
  // dev-environment live-key mix-up loud rather than silent (spec
  // section 52: "Configuration should make environment mistakes
  // obvious").
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  // The webhook endpoint's signing secret (`whsec_...`) — required to
  // verify `Stripe-Signature` (spec section 17); without it the webhook
  // route refuses every request rather than silently trusting an
  // unverified body.
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

  // --- Observability (Module 58 formalizes this; logger uses it now) ---
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

function loadServerEnv(): ServerEnv {
  const result = serverEnvSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(
      [
        "Invalid or missing environment configuration:",
        formatIssues(result.error),
        "",
        "Check .env.example for the full list of supported variables,",
        "then create a .env.local with the values you need.",
      ].join("\n"),
    );
  }

  return result.data;
}

/**
 * Validated, typed server environment. Import this instead of reading
 * `process.env` directly anywhere else in server-side code.
 */
export const serverEnv = loadServerEnv();

/**
 * Whether the database connection has been configured at all. Modules that
 * depend on Prisma (starting with Module 03) should check this before
 * assuming `DATABASE_URL` is usable — see lib/db for the guarded client.
 */
export const isDatabaseConfigured = Boolean(serverEnv.DATABASE_URL);

/** Whether the Anthropic API key is configured — gates every real call in `lib/ai/provider/anthropic/client.ts` (Module 17), the same "safe error when unconfigured, never a crash" pattern `isStripeConfigured` already established. */
export const isAnthropicConfigured = Boolean(serverEnv.ANTHROPIC_API_KEY);

/**
 * Whether Stripe is configured at all (Module 13). Billing service
 * functions that need a real provider call check this and throw
 * `ExternalServiceError("Stripe")` rather than crash with an unhelpful
 * Stripe SDK error when it's unset — the same "boot cleanly on a fresh
 * checkout" tolerance every other optional integration in this file
 * gets.
 */
export const isStripeConfigured = Boolean(serverEnv.STRIPE_SECRET_KEY);

/** True when the configured key is a live (not test-mode) Stripe secret key — see billing-provider.md "Environment separation." */
export const isStripeLiveMode = Boolean(serverEnv.STRIPE_SECRET_KEY?.startsWith("sk_live_"));
