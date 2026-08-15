import { serverEnv } from "./environment";
import { publicEnv } from "./environment.public";

/**
 * Centralized, non-secret application configuration.
 *
 * This is the single source of truth for values that would otherwise be
 * scattered as magic strings throughout the codebase ("Alpha OS",
 * "production", "USD", ...). Anything here is safe to import from both
 * server and client code — secrets live in `config/environment.ts` only.
 */
export const appConfig = {
  name: "Alpha OS",
  legalName: "Alpha Page Rankers",
  description: "The Alpha Page Rankers operating platform.",
  url: publicEnv.NEXT_PUBLIC_APP_URL,
  environment: serverEnv.NODE_ENV,

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
