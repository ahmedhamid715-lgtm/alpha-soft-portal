import { test as base, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * axe-core against Module 11's new UI — the platform organization
 * directory and a platform organization detail page (both the
 * SUSPENDED case, which renders the Reactivate control, and the
 * ARCHIVED case, which renders the terminal-state message instead).
 * Desktop only × light/dark — same documented scope reduction Module
 * 10's own accessibility spec already established.
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);
});

const SCHEMES = ["light", "dark"] as const;
const PASSWORD = "alpha-os-dev-password";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://ahmed@localhost:5432/alpha_os_dev";

async function withPgClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * This spec's own precondition, established directly rather than
 * trusted from `prisma/seed-user-org-management.ts`'s fixture — a
 * previous test run (functional or manual) elsewhere in the suite may
 * have left "suspended-org-dev" reactivated; asserting/only-reading a
 * shared fixture's status here would make this spec's pass/fail depend
 * on run order, which is exactly the flakiness this fixes.
 */
async function ensureOrgStatus(slug: string, status: "SUSPENDED" | "ARCHIVED"): Promise<void> {
  await withPgClient((client) => client.query("UPDATE organizations SET status = $2 WHERE slug = $1", [slug, status]));
}

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

base.describe("Organization management accessibility", () => {
  base("directory, a suspended organization's platform profile, and an archived one — no violations, light/dark", async ({ page }) => {
    const violations: string[] = [];
    await ensureOrgStatus("suspended-org-dev", "SUSPENDED");
    await ensureOrgStatus("archived-org-dev", "ARCHIVED");
    await loginAs(page, "platform-admin@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });

      await page.goto("/admin/organizations");
      await scan(page, `directory (${scheme})`, violations);

      await page.goto("/admin/organizations?status=SUSPENDED");
      await page.locator("table a[href^='/admin/organizations/']").first().click();
      await scan(page, `suspended organization detail (${scheme})`, violations);

      await page.goto("/admin/organizations?status=ARCHIVED");
      await page.locator("table a[href^='/admin/organizations/']").first().click();
      await scan(page, `archived organization detail (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("access-denied state (no organizations.read) — no violations", async ({ page }) => {
    const violations: string[] = [];
    await loginAs(page, "customer-a@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/admin/organizations");
      await scan(page, `access-denied (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });
});
