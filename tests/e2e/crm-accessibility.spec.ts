import { test as base, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * CRM accessibility coverage: broad desktop scans for every CRM surface plus
 * a full viewport/theme matrix for its two densest pages. Theme is persisted
 * by next-themes (`enableSystem={false}`), so media emulation cannot affect
 * this app; use localStorage before each navigation instead.
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);
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

async function orgIdBySlug(slug: string): Promise<string> {
  return withPgClient((client) => client.query("SELECT id FROM organizations WHERE slug = $1", [slug]).then((result) => result.rows[0].id as string));
}

async function seededCrmIds() {
  const organizationId = await orgIdBySlug("alpha-os-platform");
  return withPgClient(async (client) => {
    // A single pg Client executes serially; concurrent query() calls on the
    // same connection are deprecated in pg 8 and will fail in pg 9.
    const company = await client.query("SELECT id FROM crm_companies WHERE organization_id = $1 AND name = $2", [organizationId, "Acme Retail Group"]);
    const contact = await client.query("SELECT id FROM crm_contacts WHERE organization_id = $1 AND email = $2", [organizationId, "jordan.reyes@acmeretail.example"]);
    const lead = await client.query("SELECT id FROM crm_leads WHERE organization_id = $1 AND title = $2", [organizationId, "SEO audit + local landing pages — Acme Retail Group"]);
    return { companyId: company.rows[0].id as string, contactId: contact.rows[0].id as string, leadId: lead.rows[0].id as string };
  });
}

async function setColorScheme(page: Page, scheme: "light" | "dark") {
  await page.evaluate((value) => window.localStorage.setItem("theme", value), scheme);
}

async function scan(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function choose(scope: Page | Locator, label: string, option: string) {
  const rootPage = "page" in scope && typeof (scope as Locator).page === "function" ? (scope as Locator).page() : (scope as Page);
  await scope.getByLabel(label).click();
  await rootPage.getByRole("option", { name: option, exact: true }).click();
}

base.describe("CRM accessibility (Module 19)", () => {
  base("all CRM pages and populated states have no axe violations on desktop in either theme", async ({ page }) => {
    const { companyId, contactId, leadId } = await seededCrmIds();
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAs(page, "platform-admin@alpha-os.test");

    for (const scheme of ["light", "dark"] as const) {
      await setColorScheme(page, scheme);
      for (const path of [
        "/admin/crm",
        "/admin/crm/companies",
        `/admin/crm/companies/${companyId}`,
        "/admin/crm/contacts",
        `/admin/crm/contacts/${contactId}`,
        "/admin/crm/leads",
        `/admin/crm/leads/${leadId}`,
        "/admin/crm/tasks",
        "/admin/crm/settings",
      ]) {
        await page.goto(path);
        await expect(page.getByRole("main")).toBeVisible();
        await scan(page);
      }
    }
  });

  base("lead disqualification form has no axe violations", async ({ page }) => {
    const title = `[${Date.now()}] accessibility disqualification lead`;
    await loginAs(page, "platform-admin@alpha-os.test");
    await setColorScheme(page, "dark");
    await page.goto("/admin/crm/leads");
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create lead" }).click();
    await page.getByRole("link", { name: title, exact: true }).click();
    await page.getByRole("button", { name: "Mark contacted" }).click();
    await expect(page.getByRole("button", { name: "Disqualify" })).toBeVisible();
    await page.getByRole("button", { name: "Disqualify" }).click();
    await expect(page.getByLabel("Reason")).toBeVisible();
    await scan(page);
  });

  base("settings SELECT custom-field configuration has no axe violations", async ({ page }) => {
    await loginAs(page, "platform-admin@alpha-os.test");
    await setColorScheme(page, "dark");
    await page.goto("/admin/crm/settings");
    const companyFields = page.getByRole("heading", { name: "Company custom fields" }).locator("xpath=ancestor::section");
    await choose(companyFields, "Type", "Select (comma-separated options)");
    await expect(companyFields.getByLabel("Options")).toBeVisible();
    await scan(page);
  });

  base("empty contacts search state has no axe violations", async ({ page }) => {
    await loginAs(page, "platform-admin@alpha-os.test");
    await setColorScheme(page, "dark");
    await page.goto("/admin/crm/contacts?search=zzz-no-such-contact-zzz");
    await expect(page.getByText("No contacts match these filters")).toBeVisible();
    await scan(page);
  });

  base("empty new-company form has no axe violations", async ({ page }) => {
    await loginAs(page, "platform-admin@alpha-os.test");
    await setColorScheme(page, "dark");
    await page.goto("/admin/crm/companies");
    // The client disables submission until Name is non-empty, so no server
    // validation state is reachable from the real UI; scan the empty form.
    await expect(page.getByRole("button", { name: "Create company" })).toBeDisabled();
    await scan(page);
  });

  base("qualified lead supports ordinary keyboard progression without a focus trap", async ({ page }) => {
    const { leadId } = await seededCrmIds();
    await loginAs(page, "platform-admin@alpha-os.test");
    await page.goto(`/admin/crm/leads/${leadId}`);
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    const focused = new Set<string>();
    for (let index = 0; index < 30; index += 1) {
      await page.keyboard.press("Tab");
      focused.add(await page.evaluate(() => document.activeElement?.tagName ?? ""));
    }
    expect(focused.has("BUTTON")).toBeTruthy();
    expect(focused.has("INPUT") || focused.has("TEXTAREA")).toBeTruthy();
  });

  for (const scheme of ["light", "dark"] as const) {
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      base(`qualified lead detail has no axe violations (${scheme}, ${viewportName})`, async ({ page }) => {
        const { leadId } = await seededCrmIds();
        await page.setViewportSize(viewport);
        await loginAs(page, "platform-admin@alpha-os.test");
        await setColorScheme(page, scheme);
        await page.goto(`/admin/crm/leads/${leadId}`);
        await scan(page);
      });

      base(`CRM settings has no axe violations (${scheme}, ${viewportName})`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await loginAs(page, "platform-admin@alpha-os.test");
        await setColorScheme(page, scheme);
        await page.goto("/admin/crm/settings");
        await scan(page);
      });
    }
  }
});
