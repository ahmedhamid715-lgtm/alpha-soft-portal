import { test as base, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { serverIsReachable } from "./fixtures";

/**
 * axe-core against Module 06's new tenancy UI (spec section 51) —
 * `/organizations`, the same desktop/tablet/mobile × light/dark matrix
 * every other accessibility suite in this project uses. Authenticated as
 * the multi-org fixture account so the table actually renders 2 rows.
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);
});

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
} as const;

const PASSWORD = "alpha-os-dev-password";

for (const scheme of ["dark", "light"] as const) {
  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    base(`/organizations has no axe violations (${scheme}, ${viewportName})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: scheme });

      await page.goto("/login");
      await page.fill("input[name=email]", "multiorg@alpha-os.test");
      await page.fill("input[name=password]", PASSWORD);
      await page.click("button[type=submit]");
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });

      await page.goto("/organizations");
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
}
