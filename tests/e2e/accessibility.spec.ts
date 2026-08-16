import { test as base, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { serverIsReachable } from "./fixtures";

base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts for how to start it.`);
});

const PAGES = ["/login", "/forgot-password", "/reset-password?token=placeholder", "/verify-email?token=placeholder"];

// Same three breakpoints Module 02's design-system accessibility pass
// used (desktop/tablet/mobile) — this project's security audit re-runs
// axe-core across all 4 auth pages at each of them, crossed with both
// color schemes.
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
} as const;

for (const path of PAGES) {
  for (const scheme of ["dark", "light"] as const) {
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      base(`${path} has no axe violations (${scheme}, ${viewportName})`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(path);
        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
      });
    }
  }
}
