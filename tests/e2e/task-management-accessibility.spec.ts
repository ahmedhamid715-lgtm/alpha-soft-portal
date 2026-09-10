import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Task Management accessibility coverage (Build 28 — Roadmap Module 22)
 * — direct style/helper template from
 * `project-management-accessibility.spec.ts` (Build 27). Written
 * directly by Claude, same reasoning as every prior build's own top
 * comment. TWO shared sessions for the whole file (platform-admin for
 * `/admin/tasks/**`, owner-a for `/portal/tasks`) — not one login per
 * test, same rate-limiter discipline every prior accessibility suite in
 * this codebase already documents.
 */
let staffContext: BrowserContext;
let staffPage: Page;
let customerContext: BrowserContext;
let customerPage: Page;

base.beforeAll(async ({ browser, baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);

  staffContext = await browser.newContext();
  staffPage = await staffContext.newPage();
  await loginAs(staffPage, "platform-admin@alpha-os.test");

  customerContext = await browser.newContext();
  customerPage = await customerContext.newPage();
  await loginAs(customerPage, "owner-a@alpha-os.test");
});

base.afterAll(async () => {
  await staffContext?.close();
  await customerContext?.close();
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

async function seededInternalTaskId(): Promise<string | undefined> {
  return withPgClient((client) => client.query("SELECT id FROM internal_tasks ORDER BY created_at DESC LIMIT 1").then((r) => r.rows[0]?.id as string | undefined));
}

// See `task-management.spec.ts`'s own identical helper comment — the
// production error boundary's copy differs from the dev-mode overlay's.
async function expectNoApplicationError(page: Page) {
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).not.toContainText("This page couldn't load");
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  await expectNoApplicationError(page);
}

async function setColorScheme(page: Page, scheme: "light" | "dark") {
  await page.evaluate((value) => window.localStorage.setItem("theme", value), scheme);
}

/** Same STILL DEFERRED platform limitation every prior accessibility suite in this codebase documents (`project-management-accessibility.spec.ts`'s own identical constant/comment) — not re-litigated here. */
const KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS = ["aria-hidden-focus", "landmark-one-main", "page-has-heading-one", "region"];

/** Same `Button` `transition-all` settle wait every prior accessibility suite in this codebase documents. */
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

base.describe("Task Management accessibility — internal admin surface", () => {
  base("the Tasks list and New internal task form have no axe violations in either theme", async () => {
    await staffPage.setViewportSize(VIEWPORTS.desktop);
    for (const scheme of ["light", "dark"] as const) {
      await setColorScheme(staffPage, scheme);
      for (const path of ["/admin/tasks", "/admin/tasks/new"]) {
        await goto(staffPage, path);
        await expect(staffPage.getByRole("main")).toBeVisible();
        await scan(staffPage, KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS);
      }
    }
  });

  base("Team Tasks (with its own assignee filter) has no axe violations", async () => {
    await setColorScheme(staffPage, "dark");
    await goto(staffPage, "/admin/tasks?tab=team");
    await scan(staffPage, KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS);
  });

  base("a standalone task's detail/edit page has no axe violations", async () => {
    const taskId = await seededInternalTaskId();
    base.skip(!taskId, "No seeded internal task found — run task-management.spec.ts first.");
    await setColorScheme(staffPage, "light");
    await goto(staffPage, `/admin/tasks/${taskId}`);
    await scan(staffPage, KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS);
  });

  for (const scheme of ["light", "dark"] as const) {
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      base(`Tasks list has no axe violations (${scheme}, ${viewportName})`, async () => {
        await staffPage.setViewportSize(viewport);
        await setColorScheme(staffPage, scheme);
        await goto(staffPage, "/admin/tasks");
        await scan(staffPage);
      });
    }
  }
});

base.describe("Task Management accessibility — Customer Portal", () => {
  base("My Tasks has no axe violations in either theme", async () => {
    await customerPage.setViewportSize(VIEWPORTS.desktop);
    for (const scheme of ["light", "dark"] as const) {
      await setColorScheme(customerPage, scheme);
      await goto(customerPage, "/portal/tasks");
      await scan(customerPage);
    }
  });

  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    base(`My Tasks has no axe violations (${viewportName})`, async () => {
      await customerPage.setViewportSize(viewport);
      await setColorScheme(customerPage, "light");
      await goto(customerPage, "/portal/tasks");
      await scan(customerPage);
    });
  }
});
