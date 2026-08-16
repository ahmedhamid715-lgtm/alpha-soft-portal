import { defineConfig, devices } from "@playwright/test";

/**
 * E2E test config (spec section 31/37). Deliberately does NOT use
 * Playwright's `webServer` auto-start — this app's server needs
 * `DATABASE_URL` (a seeded database), `AUTH_SECRET`, and (for a
 * production build) `AUTH_TRUST_HOST`, none of which this config can
 * safely assume or fabricate. Start the server yourself first:
 *
 *   DATABASE_URL=... AUTH_SECRET=... AUTH_TRUST_HOST=true npm run build && npm run start
 *
 * then `npm run test:e2e`. Every spec checks the server is actually
 * reachable and the expected seed accounts exist before running — see
 * `tests/e2e/fixtures.ts` — and skips (not fails, not fakes a pass)
 * otherwise, the same "explicit skip" pattern the database integration
 * tests use (see docs/architecture/database.md "Testing").
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  // `fullyParallel: false` alone only serializes tests *within* one file —
  // separate spec files still ran as concurrent workers by default,
  // pounding the same in-memory rate limiter and dev seed accounts at
  // once and causing real cross-test flakiness (found by actually running
  // the suite, not by inspection). `workers: 1` forces the whole suite
  // serial, which is the right tradeoff here — this app's auth surface is
  // deliberately shared, stateful test fixtures, not isolated units.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
