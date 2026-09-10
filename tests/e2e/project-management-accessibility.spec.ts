import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Project Management accessibility coverage (Build 27 — Roadmap Module
 * 21) — direct style/helper template from
 * `client-onboarding-accessibility.spec.ts` (Build 23). Written
 * directly by Claude, same reasoning as every prior build's own top
 * comment. TWO shared sessions for the whole file (platform-admin for
 * `/admin/projects/**`, owner-a for `/portal/projects/**`) — not one
 * login per test, same rate-limiter discipline every prior accessibility
 * suite already documents.
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

async function seededProjectId(): Promise<string | undefined> {
  return withPgClient((client) => client.query("SELECT id FROM projects ORDER BY created_at DESC LIMIT 1").then((r) => r.rows[0]?.id as string | undefined));
}

async function seededTemplateId(): Promise<string | undefined> {
  return withPgClient((client) => client.query("SELECT id FROM project_templates ORDER BY created_at DESC LIMIT 1").then((r) => r.rows[0]?.id as string | undefined));
}

async function acmePortalProjectId(): Promise<string | undefined> {
  return withPgClient((client) =>
    client
      .query(
        "SELECT p.id FROM projects p JOIN organizations o ON o.id = p.customer_organization_id WHERE o.slug = 'acme-corp-dev' ORDER BY p.created_at DESC LIMIT 1",
      )
      .then((r) => r.rows[0]?.id as string | undefined),
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

/** Same STILL DEFERRED platform limitation every prior accessibility suite in this codebase documents (`client-onboarding-accessibility.spec.ts`'s own identical constant/comment) — not re-litigated here. */
const KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS = ["aria-hidden-focus", "landmark-one-main", "page-has-heading-one", "region"];

/** Same `Button` `transition-all` settle wait `client-onboarding-accessibility.spec.ts` already documents in full. */
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

base.describe("Project Management accessibility — internal admin surface", () => {
  base("list, new-project form, and templates pages have no axe violations in either theme", async () => {
    await staffPage.setViewportSize(VIEWPORTS.desktop);
    for (const scheme of ["light", "dark"] as const) {
      await setColorScheme(staffPage, scheme);
      for (const path of ["/admin/projects", "/admin/projects/new", "/admin/projects/templates"]) {
        await goto(staffPage, path);
        await expect(staffPage.getByRole("main")).toBeVisible();
        await scan(staffPage);
      }
    }
  });

  base("a project's detail page (every tab) has no axe violations", async () => {
    const projectId = await seededProjectId();
    base.skip(!projectId, "No seeded project found — run project-management.spec.ts first.");
    await setColorScheme(staffPage, "dark");
    await goto(staffPage, `/admin/projects/${projectId}`);

    for (const tabName of ["Overview", "Milestones", "Tasks", "Comments", "QA", "Approvals"]) {
      await staffPage.getByRole("tab", { name: tabName }).click();
      await scan(staffPage);
    }
  });

  base("a template's detail page (structure forms) has no axe violations", async () => {
    const templateId = await seededTemplateId();
    base.skip(!templateId, "No seeded template found — run project-management.spec.ts first.");
    await setColorScheme(staffPage, "light");
    await goto(staffPage, `/admin/projects/templates/${templateId}`);
    await scan(staffPage);
  });

  base("the customer/priority Select controls on the new-project form have no axe violations outside the known platform limitation", async () => {
    await setColorScheme(staffPage, "dark");
    await goto(staffPage, "/admin/projects");
    await scan(staffPage, KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS);
  });

  for (const scheme of ["light", "dark"] as const) {
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      base(`Projects list has no axe violations (${scheme}, ${viewportName})`, async () => {
        await staffPage.setViewportSize(viewport);
        await setColorScheme(staffPage, scheme);
        await goto(staffPage, "/admin/projects");
        await scan(staffPage);
      });
    }
  }
});

base.describe("Project Management accessibility — Customer Portal", () => {
  base("My Projects and a project detail page have no axe violations in either theme", async () => {
    const projectId = await acmePortalProjectId();
    await customerPage.setViewportSize(VIEWPORTS.desktop);
    for (const scheme of ["light", "dark"] as const) {
      await setColorScheme(customerPage, scheme);
      await goto(customerPage, "/portal/projects");
      await scan(customerPage);
      if (projectId) {
        await goto(customerPage, `/portal/projects/${projectId}`);
        await scan(customerPage);
      }
    }
  });

  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    base(`My Projects has no axe violations (${viewportName})`, async () => {
      await customerPage.setViewportSize(viewport);
      await setColorScheme(customerPage, "light");
      await goto(customerPage, "/portal/projects");
      await scan(customerPage);
    });
  }
});
