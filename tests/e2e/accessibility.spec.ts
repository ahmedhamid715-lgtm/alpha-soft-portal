import { test as base, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { serverIsReachable } from "./fixtures";

base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts for how to start it.`);
});

const PAGES = ["/login", "/forgot-password", "/reset-password?token=placeholder", "/verify-email?token=placeholder"];

for (const path of PAGES) {
  for (const scheme of ["dark", "light"] as const) {
    base(`${path} has no axe violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
}
