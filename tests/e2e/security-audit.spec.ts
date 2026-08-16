import { test as base, expect } from "@playwright/test";
import { Client } from "pg";
import { SEED_ACCOUNTS, serverIsReachable } from "./fixtures";

/**
 * Scenarios added by this project's Module 04 final security audit,
 * beyond what `auth.spec.ts`/`rate-limit.spec.ts`/`accessibility.spec.ts`
 * already cover: session revocation observed through a real browser
 * (not just curl), and account-enumeration protection on `/login` and
 * `/forgot-password`. Talks to Postgres directly via `pg` (not the app's
 * own `@/lib/db/client`, which imports `server-only` — safe to no-op
 * under Vitest's alias, but this file runs under Playwright's plain-Node
 * runner) purely to simulate an out-of-band revocation (an admin action,
 * a compromised-session response) the way `session-guard.ts`'s own
 * doc comments describe.
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts for how to start it.`);
});

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://ahmed@localhost:5432/alpha_os_dev";

async function revokeMostRecentSessionFor(email: string): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'e2e_audit_test'
       WHERE user_id = (SELECT id FROM users WHERE email = $1)
       AND id = (SELECT id FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE email = $1) ORDER BY created_at DESC LIMIT 1)`,
      [email],
    );
  } finally {
    await client.end();
  }
}

base.describe("Session revocation (real browser)", () => {
  base("a session revoked out-of-band stops working on the very next request", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[name=email]", SEED_ACCOUNTS.customer.email);
    await page.fill("input[name=password]", SEED_ACCOUNTS.customer.password);
    await page.click("button[type=submit]");
    await page.waitForURL("**/dashboard", { timeout: 30_000 });

    // The Auth.js cookie in this browser context is still fully valid
    // (unexpired, correctly signed) — only the app's own UserSession row
    // is revoked, simulating an admin-initiated revocation or a
    // compromised-session response that can't rely on the client
    // cooperating (no signOut() call happens here).
    await revokeMostRecentSessionFor(SEED_ACCOUNTS.customer.email);

    await page.reload();
    await expect(page).toHaveURL(/\/login/);

    // Note: unlike `proxy.ts`'s redirect (which preserves `callbackUrl`
    // for a never-authenticated visitor), `requireAuthenticatedPage()`'s
    // redirect does not — a revoked mid-session user lands on a bare
    // `/login`, not `/login?callbackUrl=%2Fdashboard`. This is a UX
    // inconsistency, not a security gap: access is unconditionally denied
    // either way, before any protected content renders. Documented as a
    // low-severity, non-security finding rather than fixed here — the
    // fix would mean threading a pathname header through `proxy.ts` into
    // every Server Component, which is out of this audit's scope
    // ("do not modify the architecture").
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
});

base.describe("Account enumeration protection", () => {
  base("/login gives an identical error for a nonexistent account and a wrong password", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[name=email]", `nonexistent-${Date.now()}@alpha-os.test`);
    await page.fill("input[name=password]", "whatever-wrong-password");
    await page.click("button[type=submit]");
    const nonexistentMessage = await page.locator('[data-slot="alert"]').innerText();

    await page.goto("/login");
    await page.fill("input[name=email]", SEED_ACCOUNTS.customer.email);
    await page.fill("input[name=password]", "definitely-the-wrong-password");
    await page.click("button[type=submit]");
    const wrongPasswordMessage = await page.locator('[data-slot="alert"]').innerText();

    expect(nonexistentMessage).toBe(wrongPasswordMessage);
    expect(nonexistentMessage).toContain("Invalid email or password.");
  });

  base("/forgot-password gives the identical generic response for a real and a fake account", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.fill("input[name=email]", SEED_ACCOUNTS.customer.email);
    await page.click("button[type=submit]");
    await expect(page.locator("body")).not.toContainText(/no account|not found|doesn't exist/i);
    const realAccountText = await page.locator("main").innerText();

    await page.goto("/forgot-password");
    await page.fill("input[name=email]", `nonexistent-${Date.now()}@alpha-os.test`);
    await page.click("button[type=submit]");
    await expect(page.locator("body")).not.toContainText(/no account|not found|doesn't exist/i);
    const fakeAccountText = await page.locator("main").innerText();

    expect(realAccountText).toBe(fakeAccountText);
  });
});
