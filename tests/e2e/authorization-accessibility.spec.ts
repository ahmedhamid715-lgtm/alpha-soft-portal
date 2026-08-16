import { test as base, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { serverIsReachable } from "./fixtures";

/**
 * axe-core against Module 05's new authorization UI (spec section 44) —
 * desktop/tablet/mobile × light/dark, the same matrix
 * `accessibility.spec.ts` (Module 04) established. Authenticated (a real
 * login, not a mocked session) since `/admin/roles` renders different
 * content per persona.
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

for (const [personaLabel, email] of [
  ["organization owner (roles + members view)", "owner-a@alpha-os.test"],
  ["platform admin (system roles view)", "platform-admin@alpha-os.test"],
  ["customer (access-denied view)", "customer-a@alpha-os.test"],
] as const) {
  for (const scheme of ["dark", "light"] as const) {
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      base(`/admin/roles as ${personaLabel} has no axe violations (${scheme}, ${viewportName})`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: scheme });

        await page.goto("/login");
        await page.fill("input[name=email]", email);
        await page.fill("input[name=password]", PASSWORD);
        await page.click("button[type=submit]");
        await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });

        await page.goto("/admin/roles");
        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
      });
    }
  }
}
