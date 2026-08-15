import "server-only";
import { defaultFeatureFlags, type FeatureFlagKey } from "@/config/app";

/**
 * Feature flag evaluation (spec section 21). `config/app.ts` holds the
 * static default values; this module is the *evaluation* boundary future
 * code should call through, so a real backend (a database table + admin
 * UI in Module 63, or a third-party service) can replace the defaults-only
 * implementation below without changing any call site.
 *
 * Deliberately no admin UI, no per-organization overrides, no persistence
 * yet — Module 63 (Feature Flag System) owns that.
 */
export interface FeatureFlagContext {
  userId?: string;
  organizationId?: string;
}

export interface FeatureFlagProvider {
  isEnabled(key: FeatureFlagKey, context?: FeatureFlagContext): Promise<boolean>;
}

class StaticFeatureFlagProvider implements FeatureFlagProvider {
  async isEnabled(key: FeatureFlagKey): Promise<boolean> {
    return defaultFeatureFlags[key];
  }
}

export const featureFlags: FeatureFlagProvider = new StaticFeatureFlagProvider();
