import { test as base } from "@playwright/test";

/**
 * The three dev accounts `prisma/seed.ts` creates — see that file. E2E
 * tests run against them directly rather than creating their own users
 * (no public signup flow exists in this module — see
 * docs/architecture/authentication.md "No business logic").
 */
export const SEED_ACCOUNTS = {
  owner: { email: "owner@alpha-os.test", password: "alpha-os-dev-password", destination: "/admin" },
  support: { email: "support@alpha-os.test", password: "alpha-os-dev-password", destination: "/support" },
  customer: { email: "customer@alpha-os.test", password: "alpha-os-dev-password", destination: "/dashboard" },
} as const;

/**
 * `test.skip()` when the app isn't reachable at all — these specs need a
 * real running server (built with a real `DATABASE_URL`/`AUTH_SECRET`,
 * seeded), which CI/a fresh checkout won't have by default. See
 * playwright.config.ts's top comment for how to actually run this suite.
 */
export const test = base.extend({});

export async function serverIsReachable(baseURL: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
