import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * SEO OS accessibility coverage (Build 30 — Roadmap Module 24) — direct
 * style/helper template from `service-management-accessibility.spec.ts`
 * (Build 29). ONE shared platform-admin session for the whole file —
 * not one login per test, same rate-limiter discipline every prior
 * accessibility suite in this codebase documents.
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
  return withPgClient((client) => client.query("SELECT id FROM seo_engagements ORDER BY created_at DESC LIMIT 1").then((r) => r.rows[0]?.id as string | undefined));
}

async function seededPropertyId(): Promise<{ engagementId: string; propertyId: string } | undefined> {
  return withPgClient((client) =>
    client.query("SELECT engagement_id, id FROM seo_properties ORDER BY created_at DESC LIMIT 1").then((r) => (r.rows[0] ? { engagementId: r.rows[0].engagement_id as string, propertyId: r.rows[0].id as string } : undefined)),
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

base.describe("SEO OS accessibility — internal admin surface", () => {
  base("the SEO list page has no axe violations in either theme", async () => {
    await staffPage.setViewportSize(VIEWPORTS.desktop);
    for (const scheme of ["light", "dark"] as const) {
      await setColorScheme(staffPage, scheme);
      await goto(staffPage, "/admin/seo");
      await expect(staffPage.getByRole("main")).toBeVisible();
      await scan(staffPage);
    }
  });

  base("an engagement workspace (properties list, add-property form open) has no axe violations", async () => {
    const engagementId = await seededEngagementId();
    base.skip(!engagementId, "No seeded SEO engagement found — run seo-os.spec.ts first.");
    await setColorScheme(staffPage, "dark");
    await goto(staffPage, `/admin/seo/${engagementId}`);
    await scan(staffPage);
    const addButton = staffPage.getByRole("button", { name: "Add property" });
    if (await addButton.count()) {
      await addButton.click();
      await scan(staffPage);
    }
  });

  base("a property workspace's Keywords/Issues/Audits/Import tabs each have no axe violations", async () => {
    const seeded = await seededPropertyId();
    base.skip(!seeded, "No seeded SEO property found — run seo-os.spec.ts first.");
    await setColorScheme(staffPage, "light");
    for (const tab of ["keywords", "issues", "audits", "import"]) {
      await goto(staffPage, `/admin/seo/${seeded!.engagementId}/properties/${seeded!.propertyId}?tab=${tab}`);
      await scan(staffPage, KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS);
    }
  });

  for (const scheme of ["light", "dark"] as const) {
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      base(`SEO list has no axe violations (${scheme}, ${viewportName})`, async () => {
        await staffPage.setViewportSize(viewport);
        await setColorScheme(staffPage, scheme);
        await goto(staffPage, "/admin/seo");
        await scan(staffPage);
      });
    }
  }
});
