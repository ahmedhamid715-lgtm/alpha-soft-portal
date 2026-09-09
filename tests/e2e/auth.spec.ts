import { test as base, expect } from "@playwright/test";
import { SEED_ACCOUNTS, serverIsReachable } from "./fixtures";

/**
 * E2E auth flows (spec section 31/46) — real browser, real running app,
 * real database. Token-based flows (password reset, email verification)
 * are covered in `tests/integration/db/` instead, at the service layer —
 * they need the raw token value, which (correctly) never appears
 * anywhere the browser/HTTP layer can see it once the app is running in
 * production mode (see lib/mail/mailer.ts) — the service layer is the
 * right place to exercise that path directly against the real database.
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts for how to start it.`);
});

base.describe("Login", () => {
  base("rejects invalid credentials with a generic, safe error", async ({ page }) => {
    // A random suffix per run — reusing a fixed nonexistent-account email
    // across repeated test runs would eventually trip the login rate
    // limiter (a *different*, also-safe outcome — see rate-limit.spec.ts
    // — but not what this specific test is asserting).
    await page.goto("/login");
    await page.fill("input[name=email]", `nonexistent-${Date.now()}@alpha-os.test`);
    await page.fill("input[name=password]", "wrong-password-here");
    await page.click("button[type=submit]");
    await expect(page.locator('[data-slot="alert"]')).toContainText("Invalid email or password.");
    await expect(page).toHaveURL(/\/login$/);
  });

  for (const [role, account] of Object.entries(SEED_ACCOUNTS)) {
    if (!("destination" in account)) continue; // owner — tested separately below, its destination is a dynamic organization id, not a fixed path.
    base(`routes ${role} to ${account.destination} on successful login`, async ({ page }) => {
      await page.goto("/login");
      await page.fill("input[name=email]", account.email);
      await page.fill("input[name=password]", account.password);
      await page.click("button[type=submit]");
      await page.waitForURL(`**${account.destination}`, { timeout: 30_000 });
      await expect(page).toHaveURL(new RegExp(`${account.destination}$`));
    });
  }

  base("routes owner (an ORGANIZATION-scope role) to their own organization's page on successful login, not the platform-only /admin", async ({ page }) => {
    // See `lib/auth/destination.ts`'s own top comment — `owner`/`admin`
    // are ORGANIZATION-scope role keys reused by every regular tenant
    // organization, distinct from the PLATFORM-scope `platform_owner`/
    // `platform_admin`. `owner@alpha-os.test` administers only its own
    // seeded organization, so it belongs on that organization's page,
    // never on `/admin` (exclusively platform-scope tooling).
    await page.goto("/login");
    await page.fill("input[name=email]", SEED_ACCOUNTS.owner.email);
    await page.fill("input[name=password]", SEED_ACCOUNTS.owner.password);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/organizations\/[0-9a-f-]{36}$/i, { timeout: 30_000 });
  });

  base("preserves a same-origin callbackUrl through login", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fadmin/);
    await page.fill("input[name=email]", SEED_ACCOUNTS.owner.email);
    await page.fill("input[name=password]", SEED_ACCOUNTS.owner.password);
    await page.click("button[type=submit]");
    await page.waitForURL("**/admin", { timeout: 30_000 });
  });
});

base.describe("Protected routes", () => {
  base("redirects an unauthenticated request to /login with callbackUrl", async ({ page }) => {
    await page.goto("/support");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fsupport/);
  });
});

base.describe("Logout", () => {
  base("clears the session and blocks re-entry to the protected page", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[name=email]", SEED_ACCOUNTS.customer.email);
    await page.fill("input[name=password]", SEED_ACCOUNTS.customer.password);
    await page.click("button[type=submit]");
    // Build 26 — `DESTINATIONS.customer` now points at `/portal` (the
    // real Customer Portal), not the old Module 04 `/dashboard`
    // placeholder (which itself now just redirects to `/portal`).
    await page.waitForURL("**/portal", { timeout: 30_000 });

    await page.click('button:has-text("Sign out")');
    await page.waitForURL("**/login", { timeout: 30_000 });

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fdashboard/);
  });
});
