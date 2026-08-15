import { publicEnv } from "./environment.public";

/**
 * Centralized, non-secret application configuration.
 *
 * This is the single source of truth for values that would otherwise be
 * scattered as magic strings throughout the codebase ("Alpha OS",
 * "production", "USD", ...). Anything here is genuinely safe to import
 * from both server and client code — secrets live in `config/environment.ts`
 * only, and this file must never import that module. It did, briefly, in
 * Module 01 (for `environment`, below) — harmless until Module 02's first
 * client component (`AppSidebar`) imported `appConfig` and Next.js's
 * server-only enforcement correctly failed the build. `NODE_ENV` doesn't
 * need `serverEnv` at all: Next.js inlines `process.env.NODE_ENV`
 * identically into both server and client bundles, unlike every other
 * environment variable, so reading it directly here carries no server-only
 * dependency.
 */
export const appConfig = {
  name: "Alpha OS",
  legalName: "Alpha Page Rankers",
  description: "The Alpha Page Rankers operating platform.",
  url: publicEnv.NEXT_PUBLIC_APP_URL,
  environment: (process.env.NODE_ENV ?? "development") as "development" | "test" | "production",

  /** Default locale/timezone/currency. Becomes per-organization in Module 06. */
  defaults: {
    locale: "en-US",
    timezone: "America/New_York",
    currency: "USD",
  },
} as const;

/**
 * Default feature-flag values for this deployment. The evaluation
 * abstraction lives in `lib/platform/feature-flags.ts` — this object is
 * just the static default set a later admin UI (Module 63) would override.
 */
export const defaultFeatureFlags = {
  AI_CHAT: false,
  ADVANCED_REPORTING: false,
  NEW_CUSTOMER_DASHBOARD: false,
  AUTOMATION_ENGINE: false,
  BILLING_V2: false,
} as const;

export type FeatureFlagKey = keyof typeof defaultFeatureFlags;
