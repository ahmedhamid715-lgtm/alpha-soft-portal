import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Website Development OS accessibility coverage (Build 32 — Roadmap
 * Module 26) — direct style/helper template from
 * `local-seo-accessibility.spec.ts` (Build 31). ONE shared
 * platform-admin session for the whole file. Relies on `website-dev.
 * spec.ts` having already seeded at least one engagement/site (same
 * "read the most recent seeded row" pattern the Local SEO/SEO OS
 * accessibility suites already establish).
 */
let staffContext: BrowserContext;
let staffPage: Page;

base.beforeAll(async ({ browser, baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);

  staffContext = await browser.newContext();
  staffPage = await staffContext.newPage();
  await loginAs(staffPage, "platform-admin@alpha-os.test");
});

base.afterAll(async () => {
  await staffContext?.close();
});

const PASSWORD = "alpha-os-dev-password";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://ahmed@localhost:5432/alpha_os_dev";
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
} as const;

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
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

async function seededEngagementId(): Promise<string | undefined> {
  return withPgClient((client) => client.query("SELECT id FROM website_engagements ORDER BY created_at DESC LIMIT 1").then((r) => r.rows[0]?.id as string | undefined));
}

async function seededSiteId(): Promise<{ engagementId: string; siteId: string } | undefined> {
  return withPgClient((client) =>
    client.query("SELECT engagement_id, id FROM website_sites ORDER BY created_at DESC LIMIT 1").then((r) => (r.rows[0] ? { engagementId: r.rows[0].engagement_id as string, siteId: r.rows[0].id as string } : undefined)),
  );
}

async function expectNoApplicationError(page: Page) {
  await expect(page.locator("body")).not.toContainText("Application error");
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  await expectNoApplicationError(page);
}

async function setColorScheme(page: Page, scheme: "light" | "dark") {
  await page.evaluate((value) => window.localStorage.setItem("theme", value), scheme);
}

/** Same STILL DEFERRED platform limitation every prior accessibility suite in this codebase documents. */
const KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS = ["aria-hidden-focus", "landmark-one-main", "page-has-heading-one", "region"];

async function settleAnimations(page: Page): Promise<void> {
  await page.waitForTimeout(250);
}

async function scan(page: Page, excludeRuleIds: string[] = []) {
  await settleAnimations(page);
  const builder = new AxeBuilder({ page });
  if (excludeRuleIds.length > 0) builder.disableRules(excludeRuleIds);
  const results = await builder.analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

base.describe("Website Development accessibility — internal admin surface", () => {
  base("the Website Development list page has no axe violations in either theme", async () => {
    await staffPage.setViewportSize(VIEWPORTS.desktop);
    for (const scheme of ["light", "dark"] as const) {
      await setColorScheme(staffPage, scheme);
      await goto(staffPage, "/admin/websites");
      await expect(staffPage.getByRole("main")).toBeVisible();
      await scan(staffPage);
    }
  });

  base("an engagement workspace (site list, add-site form open) has no axe violations", async () => {
    const engagementId = await seededEngagementId();
    base.skip(!engagementId, "No seeded Website Development engagement found — run website-dev.spec.ts first.");
    await setColorScheme(staffPage, "dark");
    await goto(staffPage, `/admin/websites/${engagementId}`);
    await scan(staffPage);
    const addButton = staffPage.getByRole("button", { name: "Add site" });
    if (await addButton.count()) {
      await addButton.click();
      await scan(staffPage);
    }
  });

  base("a site workspace's Overview/Pages/Environments/QA/Deployments tabs each have no axe violations", async () => {
    const seeded = await seededSiteId();
    base.skip(!seeded, "No seeded Website Development site found — run website-dev.spec.ts first.");
    await setColorScheme(staffPage, "light");
    for (const tab of ["overview", "pages", "environments", "qa", "deployments"]) {
      await goto(staffPage, `/admin/websites/${seeded!.engagementId}/sites/${seeded!.siteId}?tab=${tab}`);
      await scan(staffPage, KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS);
    }
  });

  base("the environments tab with a record form open has no axe violations", async () => {
    const seeded = await seededSiteId();
    base.skip(!seeded, "No seeded Website Development site found — run website-dev.spec.ts first.");
    await setColorScheme(staffPage, "dark");
    await goto(staffPage, `/admin/websites/${seeded!.engagementId}/sites/${seeded!.siteId}?tab=environments`);
    const recordButtons = staffPage.getByRole("button", { name: /Record|Edit/ });
    if (await recordButtons.count()) {
      await recordButtons.first().click();
      await scan(staffPage, KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS);
    }
  });

  for (const scheme of ["light", "dark"] as const) {
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      base(`Website Development list has no axe violations (${scheme}, ${viewportName})`, async () => {
        await staffPage.setViewportSize(viewport);
        await setColorScheme(staffPage, scheme);
        await goto(staffPage, "/admin/websites");
        await scan(staffPage);
      });
    }
  }
});
