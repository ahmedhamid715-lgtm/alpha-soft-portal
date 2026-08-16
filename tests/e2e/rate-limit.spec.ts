import { test as base, expect } from "@playwright/test";
import { serverIsReachable } from "./fixtures";

base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts for how to start it.`);
});

/**
 * Kept in its own file, run in isolation from auth.spec.ts (spec section
 * 14/32) — it deliberately exhausts the login rate limit for one email,
 * which would otherwise make *other* tests reusing that email flaky.
 */
base("throttles repeated login attempts for the same account", async ({ page }) => {
  const email = `rate-limit-test-${Date.now()}@alpha-os.test`;
  await page.goto("/login", { waitUntil: "networkidle" });
  const submitButton = page.locator('button[type="submit"]');
  await submitButton.waitFor({ state: "visible" });

  // authRateLimiter allows 10 attempts per 15-minute window (rate-limit.ts) — the 11th must be throttled.
  for (let i = 0; i < 11; i++) {
    // Waiting for the button to be enabled (not mid-submit from the
    // previous iteration) before filling is what actually matters here —
    // filling immediately after the previous submission, while the
    // `useActionState` transition was still settling, intermittently lost
    // the typed values entirely (the form submitted empty). Found by
    // screenshotting an actual failure, not by inspection.
    await expect(submitButton).toBeEnabled();
    await page.fill("input[name=email]", email);
    await page.fill("input[name=password]", "wrong-password");
    await submitButton.click();
    // `[role="alert"]` alone would resolve immediately against Next.js's
    // own always-present route announcer (`__next-route-announcer__`),
    // never actually waiting for the real error to render.
    await page.waitForSelector('[data-slot="alert"]', { timeout: 15_000 });
  }

  await expect(page.locator('[data-slot="alert"]')).toContainText("Too many attempts");
});
