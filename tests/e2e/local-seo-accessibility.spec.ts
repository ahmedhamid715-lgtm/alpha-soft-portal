import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Local SEO / GBP accessibility coverage (Build 31 — Roadmap Module 25)
 * — direct style/helper template from `seo-os-accessibility.spec.ts`
 * (Build 30). ONE shared platform-admin session for the whole file.
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
  return withPgClient((client) => client.query("SELECT id FROM local_seo_engagements ORDER BY created_at DESC LIMIT 1").then((r) => r.rows[0]?.id as string | undefined));
}

async function seededLocationId(): Promise<{ engagementId: string; locationId: string } | undefined> {
  return withPgClient((client) =>
    client.query("SELECT engagement_id, id FROM local_seo_locations ORDER BY created_at DESC LIMIT 1").then((r) => (r.rows[0] ? { engagementId: r.rows[0].engagement_id as string, locationId: r.rows[0].id as string } : undefined)),
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

base.describe("Local SEO accessibility — internal admin surface", () => {
  base("the Local SEO list page has no axe violations in either theme", async () => {
    await staffPage.setViewportSize(VIEWPORTS.desktop);
    for (const scheme of ["light", "dark"] as const) {
      await setColorScheme(staffPage, scheme);
      await goto(staffPage, "/admin/local-seo");
      await expect(staffPage.getByRole("main")).toBeVisible();
      await scan(staffPage);
    }
  });

  base("an engagement workspace (locations list, add-location form open) has no axe violations", async () => {
    const engagementId = await seededEngagementId();
    base.skip(!engagementId, "No seeded Local SEO engagement found — run local-seo.spec.ts first.");
    await setColorScheme(staffPage, "dark");
    await goto(staffPage, `/admin/local-seo/${engagementId}`);
    await scan(staffPage);
    const addButton = staffPage.getByRole("button", { name: "Add location" });
    if (await addButton.count()) {
      await addButton.click();
      await scan(staffPage);
    }
  });

  base("a location workspace's Profile/Keywords/Listings/Reviews/Issues/Audits/Import tabs each have no axe violations", async () => {
    const seeded = await seededLocationId();
    base.skip(!seeded, "No seeded Local SEO location found — run local-seo.spec.ts first.");
    await setColorScheme(staffPage, "light");
    for (const tab of ["profile", "keywords", "listings", "reviews", "issues", "audits", "import"]) {
      await goto(staffPage, `/admin/local-seo/${seeded!.engagementId}/locations/${seeded!.locationId}?tab=${tab}`);
      await scan(staffPage, KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS);
    }
  });

  for (const scheme of ["light", "dark"] as const) {
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      base(`Local SEO list has no axe violations (${scheme}, ${viewportName})`, async () => {
        await staffPage.setViewportSize(viewport);
        await setColorScheme(staffPage, scheme);
        await goto(staffPage, "/admin/local-seo");
        await scan(staffPage);
      });
    }
  }
});
