import { test as base, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * axe-core against Module 18's new knowledge surfaces — organization-
 * scoped source/document pages and the platform knowledge observability
 * page. Desktop only × light/dark. Uses the REAL theme-switching
 * mechanism (`localStorage['theme']`), not `page.emulateMedia()` — see
 * `ai-assistant-accessibility.spec.ts`'s own extensive top comment
 * (Module 17) for why the latter is a no-op in this app; not repeated
 * here.
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);
});

const SCHEMES = ["light", "dark"] as const;
const PASSWORD = "alpha-os-dev-password";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://ahmed@localhost:5432/alpha_os_dev";

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

async function setColorScheme(page: Page, scheme: "light" | "dark") {
  await page.evaluate((s) => window.localStorage.setItem("theme", s), scheme);
}

async function withPgClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function orgIdBySlug(slug: string): Promise<string> {
  return withPgClient((client) => client.query("SELECT id FROM organizations WHERE slug = $1", [slug]).then((r) => r.rows[0].id as string));
}

async function scan(page: Page, label: string, violations: string[]) {
  const results = await new AxeBuilder({ page }).analyze();
  if (results.violations.length > 0) {
    violations.push(`${label}: ${JSON.stringify(results.violations, null, 2)}`);
  }
}

base.describe("Knowledge accessibility (Module 18)", () => {
  base("organization knowledge page (search + new-source form + source list): zero axe violations, light + dark", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    const violations: string[] = [];
    await loginAs(page, "owner-a@alpha-os.test");

    for (const scheme of SCHEMES) {
      await setColorScheme(page, scheme);
      await page.goto(`/organizations/${orgAId}/knowledge`);
      await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();
      await scan(page, `knowledge page (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("source detail page (ingest form + document list): zero axe violations, light + dark", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    const violations: string[] = [];
    await loginAs(page, "owner-a@alpha-os.test");

    // Create one real source to scan its own detail page.
    await page.goto(`/organizations/${orgAId}/knowledge`);
    const uniqueId = `${Date.now()}`;
    await page.getByLabel("Name").fill(`[${uniqueId}] A11y Source`);
    await page.getByRole("button", { name: "Create source" }).click();
    await page.waitForURL((url) => /\/knowledge\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 15_000 });
    const sourceUrl = page.url();

    for (const scheme of SCHEMES) {
      await setColorScheme(page, scheme);
      await page.goto(sourceUrl);
      await expect(page.getByRole("heading", { name: `[${uniqueId}] A11y Source` })).toBeVisible();
      await scan(page, `source detail page (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("platform knowledge observability page: zero axe violations, light + dark", async ({ page }) => {
    const violations: string[] = [];
    await loginAs(page, "platform-owner@alpha-os.test");

    for (const scheme of SCHEMES) {
      await setColorScheme(page, scheme);
      await page.goto("/admin/ai/knowledge");
      await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();
      await scan(page, `admin knowledge page (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });
});
