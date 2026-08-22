import { test as base, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { serverIsReachable } from "./fixtures";

/**
 * axe-core against Module 16's new billing-compliance surface — the
 * revenue recognition / tax compliance page (metric tiles, the
 * recognition trend chart + its accessible table equivalent, the tax
 * breakdown table). Same documented scope (desktop only × light/dark)
 * as `billing-intelligence-accessibility.spec.ts`.
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

base.describe("Billing compliance accessibility (Module 16)", () => {
  base("revenue recognition & tax compliance page, incl. the recognition trend chart's accessible table and the tax breakdown table: zero axe violations, light + dark", async ({ page }) => {
    const violations: string[] = [];
    await loginAs(page, "platform-owner@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/admin/billing/compliance");
      await expect(page.getByRole("heading", { name: "Revenue recognition & tax compliance" })).toBeVisible();
      await scan(page, `billing compliance page (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });
});
