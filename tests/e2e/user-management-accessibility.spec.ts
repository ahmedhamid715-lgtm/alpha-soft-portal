import { test as base, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { serverIsReachable } from "./fixtures";

/**
 * axe-core against Module 10's new UI — the directory, a user's detail
 * page, the create-platform-user form, and self-service sessions.
 * Desktop only × light/dark (a deliberate, documented scope reduction
 * from the full desktop/tablet/mobile matrix `audit-accessibility.spec.ts`
 * runs — see `docs/architecture/user-security.md`'s sibling note; time-
 * boxed to the highest-value combination rather than the full grid).
 * Logs in once per persona, loops scheme inside each test — same
 * rate-limit-budget discipline every other E2E spec in this project
 * follows.
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);
});

const SCHEMES = ["light", "dark"] as const;
const PASSWORD = "alpha-os-dev-password";

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

async function scan(page: Page, label: string, violations: string[]) {
  const results = await new AxeBuilder({ page }).analyze();
  if (results.violations.length > 0) {
    violations.push(`${label}: ${JSON.stringify(results.violations, null, 2)}`);
  }
}

base.describe("User management accessibility", () => {
  base("directory, a user's detail page, and the create-user form — no violations, light/dark", async ({ page }) => {
    const violations: string[] = [];
    await loginAs(page, "platform-owner@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });

      await page.goto("/admin/users");
      await scan(page, `directory (${scheme})`, violations);

      await page.goto("/admin/users?search=member-a%40alpha-os.test");
      await page.locator("table a[href^='/admin/users/']").first().click();
      await scan(page, `user detail (${scheme})`, violations);

      await page.goto("/admin/users/new");
      await scan(page, `create platform user (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("self-service sessions page — no violations, light/dark", async ({ page }) => {
    const violations: string[] = [];
    await loginAs(page, "admin-a@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/settings/sessions");
      await scan(page, `sessions (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("access-denied state (no users.read) — no violations", async ({ page }) => {
    const violations: string[] = [];
    await loginAs(page, "customer-a@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/admin/users");
      await scan(page, `access-denied (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });
});
