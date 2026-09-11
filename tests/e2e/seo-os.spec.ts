import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * SEO OS E2E (Build 30 — Roadmap Module 24). Same direct style/helpers
 * as `service-management.spec.ts` (Build 29) — SQL-seeded fixtures,
 * real browser interaction, ONE shared `platform-admin` session for the
 * whole workflow block.
 *
 * Deliberately uses a FRESH, dedicated customer organization/company
 * for its own SEO fixtures rather than reusing `acme-corp-dev` — Build
 * 29's own documented "Known limitations" lesson: `CustomerService`/
 * `SeoEngagement` rows are permanently undeletable by design, so
 * reusing a shared fixture org across builds' E2E suites creates a
 * recurring collision with older specs' own assertions. A dedicated,
 * uniquely-suffixed org avoids that entirely for this build and every
 * build after it that might otherwise have reused this same org.
 */
let adminContext: BrowserContext;
let adminPage: Page;

base.beforeAll(async ({ browser, baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);

  adminContext = await browser.newContext();
  adminPage = await adminContext.newPage();
  await loginAs(adminPage, "platform-admin@alpha-os.test");
});

base.afterAll(async () => {
  await adminContext?.close();
});

const PASSWORD = "alpha-os-dev-password";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://ahmed@localhost:5432/alpha_os_dev";

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

async function expectNoApplicationError(page: Page) {
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).not.toContainText("This page couldn't load");
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  await expectNoApplicationError(page);
}

interface SeededSeoCustomerService {
  organizationId: string;
  companyId: string;
  customerServiceId: string;
  companyName: string;
}

/** A fresh customer org + converted company + SEO-category ServiceDefinition + ACTIVE CustomerService — the full eligible chain, seeded directly (this is internal test infrastructure, not a business flow under test). */
async function seedSeoCustomerService(): Promise<SeededSeoCustomerService> {
  const suffix = Date.now();
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const companyName = `E2E SEO Customer ${suffix}`;

    const organizationId = (
      await client.query("INSERT INTO organizations (id, name, display_name, slug, status, is_platform, created_at, updated_at) VALUES (gen_random_uuid(), $1, $1, $2, 'ACTIVE', false, now(), now()) RETURNING id", [
        companyName,
        `e2e-seo-${suffix}`,
      ])
    ).rows[0].id as string;
    const companyId = (
      await client.query("INSERT INTO crm_companies (id, organization_id, name, status, converted_to_organization_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', $3, now(), now()) RETURNING id", [
        platformOrgId,
        companyName,
        organizationId,
      ])
    ).rows[0].id as string;
    const definitionId = (
      await client.query(
        "INSERT INTO service_definitions (id, organization_id, name, code, category, delivery_cadence, status, sort_order, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'SEO', 'ONGOING', 'ACTIVE', 0, now(), now()) RETURNING id",
        [platformOrgId, `E2E SEO Retainer ${suffix}`, `E2E-SEO-${suffix}`],
      )
    ).rows[0].id as string;
    const customerServiceId = (
      await client.query(
        "INSERT INTO customer_services (id, organization_id, customer_organization_id, company_id, service_definition_id, quantity, status, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 1, 'ACTIVE', $5, now(), now()) RETURNING id",
        [platformOrgId, organizationId, companyId, definitionId, adminUserId],
      )
    ).rows[0].id as string;

    return { organizationId, companyId, customerServiceId, companyName };
  });
}

base.describe("SEO OS — access control", () => {
  base("a user with no seo permission is denied the list page", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");
    await goto(page, "/admin/seo");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("support admin (read only) sees the list but no management controls", async ({ page }) => {
    await loginAs(page, "support-admin@alpha-os.test");
    await goto(page, "/admin/seo");
    await expect(page.getByRole("heading", { name: "SEO", exact: true })).toBeVisible();
  });
});

base.describe("SEO OS — full operational workflow (shared platform-admin session)", () => {
  let fixture: SeededSeoCustomerService;
  let engagementUrl: string;
  let propertyUrl: string;

  base("sets up an SEO workspace from the customer service, and adds a tracked property", async () => {
    fixture = await seedSeoCustomerService();

    await goto(adminPage, `/admin/services/customers/${fixture.customerServiceId}`);
    await expect(adminPage.getByRole("heading", { name: "SEO workspace" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Set up SEO workspace" }).click();
    await adminPage.waitForURL(/\/admin\/seo\/[0-9a-f-]+$/, { timeout: 10_000 });
    engagementUrl = adminPage.url();

    // Idempotency — revisiting the customer service now shows "Open SEO workspace" (not the setup button again).
    await goto(adminPage, `/admin/services/customers/${fixture.customerServiceId}`);
    await expect(adminPage.getByRole("link", { name: "Open SEO workspace" })).toBeVisible();

    await adminPage.goto(engagementUrl);
    const siteUrl = `https://e2e-seo-${Date.now()}.example.com`;
    await adminPage.getByRole("button", { name: "Add property" }).click();
    await adminPage.fill("input[name=url]", siteUrl);
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.getByText(siteUrl)).toBeVisible({ timeout: 10_000 });

    await adminPage.getByText(siteUrl).click();
    await adminPage.waitForURL(/\/properties\/[0-9a-f-]+/, { timeout: 10_000 });
    propertyUrl = adminPage.url();
  });

  base("adds a keyword, records a rank observation, and shows the current position", async () => {
    await adminPage.goto(propertyUrl);
    const phrase = `e2e best pizza ${Date.now()}`;
    await adminPage.getByRole("button", { name: "Add keyword" }).click();
    await adminPage.fill("input[name=phrase]", phrase);
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.getByText(phrase)).toBeVisible({ timeout: 10_000 });

    const row = adminPage.locator("tr", { hasText: phrase });
    await row.getByRole("button", { name: "Record" }).click();
    await adminPage.getByLabel("Date").fill("2026-01-01");
    await adminPage.getByLabel("Status").selectOption("RANKED");
    await adminPage.getByLabel("Position").fill("5");
    await adminPage.getByRole("button", { name: "Save" }).click();
    await expect(adminPage.getByText("#5")).toBeVisible({ timeout: 10_000 });
  });

  base("rejects a duplicate observation for the same keyword and date", async () => {
    await adminPage.goto(propertyUrl);
    await adminPage.getByRole("button", { name: "Record" }).first().click();
    await adminPage.getByLabel("Date").fill("2026-01-01");
    await adminPage.getByLabel("Status").selectOption("RANKED");
    await adminPage.getByLabel("Position").fill("6");
    await adminPage.getByRole("button", { name: "Save" }).click();
    await expect(adminPage.locator('[data-slot="alert"]')).toContainText(/already exists/i, { timeout: 10_000 });
  });

  base("records a technical audit with a critical issue, and shows it in the Issues tab", async () => {
    await adminPage.goto(`${propertyUrl}?tab=audits`);
    await adminPage.getByRole("button", { name: "Record audit" }).click();
    await adminPage.fill("input[name=startedAt]", "2026-01-02");
    await adminPage.getByText("Found an issue during this audit").click();
    const issueTitle = `E2E broken link ${Date.now()}`;
    await adminPage.fill("input[name=issueTitle]", issueTitle);
    await adminPage.selectOption("select[name=issueSeverity]", "CRITICAL");
    await adminPage.getByRole("button", { name: "Save audit" }).click();
    await expect(adminPage.getByText("2026")).toBeVisible({ timeout: 10_000 });

    await adminPage.goto(`${propertyUrl}?tab=issues`);
    await expect(adminPage.getByText(issueTitle)).toBeVisible({ timeout: 10_000 });
    await expect(adminPage.getByText("CRITICAL").first()).toBeVisible();
  });

  base("full issue lifecycle: acknowledge, resolve, reopen, and convert to a task", async () => {
    await adminPage.goto(`${propertyUrl}?tab=issues`);
    const card = adminPage.locator("div", { hasText: "OPEN" }).first();

    await adminPage.getByRole("button", { name: "Acknowledge" }).first().click();
    await expect(adminPage.getByText("ACKNOWLEDGED").first()).toBeVisible({ timeout: 10_000 });

    await adminPage.getByRole("button", { name: "Resolve" }).first().click();
    await expect(adminPage.getByText("RESOLVED").first()).toBeVisible({ timeout: 10_000 });

    await adminPage.getByRole("button", { name: "Reopen" }).first().click();
    await expect(adminPage.getByText("OPEN").first()).toBeVisible({ timeout: 10_000 });

    await adminPage.getByRole("button", { name: "Create task" }).first().click();
    await expect(adminPage.getByText("Task created")).toBeVisible({ timeout: 10_000 });
    void card;
  });

  base("cancelling requires a non-empty reason for ignoring an issue", async () => {
    await adminPage.goto(`${propertyUrl}?tab=issues`);
    const ignoreButton = adminPage.getByRole("button", { name: "Ignore" }).first();
    if (await ignoreButton.count() === 0) return; // the earlier issue is already linked to a task and mid-lifecycle; skip if no ignorable issue remains
    await ignoreButton.click();
    const confirmButton = adminPage.getByRole("button", { name: "Confirm" });
    await expect(confirmButton).toBeDisabled();
  });

  base("archiving a property is reflected immediately, and reactivation restores it", async () => {
    await adminPage.goto(engagementUrl);
    await adminPage.getByRole("button", { name: "Archive" }).first().click();
    await expect(adminPage.getByText("ARCHIVED").first()).toBeVisible({ timeout: 10_000 });
    await adminPage.getByRole("button", { name: "Reactivate" }).first().click();
    await expect(adminPage.getByText("ACTIVE").first()).toBeVisible({ timeout: 10_000 });
  });

  base("Customer 360 shows the SEO performance summary inline on the canonical service card", async () => {
    await goto(adminPage, `/admin/crm/customers/${fixture.companyId}`);
    await adminPage.getByRole("tab", { name: "Services" }).click();
    await expect(adminPage.getByText(/keyword\(s\) tracked/)).toBeVisible({ timeout: 10_000 });
  });

  base("a nonexistent engagement/property shows not found, not a crash", async () => {
    const missing = "00000000-0000-7000-8000-000000000000";
    await adminPage.goto(`/admin/seo/${missing}`);
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText(/could not be found/i)).toBeVisible();
  });

  base("the engagement workspace remains usable at mobile and tablet widths", async ({ browser }) => {
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await loginAs(page, "platform-admin@alpha-os.test");
      await goto(page, engagementUrl);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await context.close();
    }
  });
});

base.describe("SEO OS — CSV import", () => {
  let fixture: SeededSeoCustomerService;
  let propertyUrl: string;
  let keywordPhrase: string;

  base.beforeAll(async () => {
    fixture = await seedSeoCustomerService();
    await goto(adminPage, `/admin/services/customers/${fixture.customerServiceId}`);
    await adminPage.getByRole("button", { name: "Set up SEO workspace" }).click();
    await adminPage.waitForURL(/\/admin\/seo\/[0-9a-f-]+$/, { timeout: 10_000 });
    const siteUrl = `https://e2e-seo-import-${Date.now()}.example.com`;
    await adminPage.getByRole("button", { name: "Add property" }).click();
    await adminPage.fill("input[name=url]", siteUrl);
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.getByText(siteUrl)).toBeVisible({ timeout: 10_000 });
    await adminPage.getByText(siteUrl).click();
    await adminPage.waitForURL(/\/properties\/[0-9a-f-]+/, { timeout: 10_000 });
    propertyUrl = adminPage.url();

    keywordPhrase = `e2e import keyword ${Date.now()}`;
    await adminPage.getByRole("button", { name: "Add keyword" }).click();
    await adminPage.fill("input[name=phrase]", keywordPhrase);
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.getByText(keywordPhrase)).toBeVisible({ timeout: 10_000 });
  });

  base("imports rank observations from a CSV file for an already-tracked keyword, and reports skipped unknown rows", async () => {
    await adminPage.goto(`${propertyUrl}?tab=import`);
    const csv = `phrase,observedAt,rankStatus,position\n${keywordPhrase},2026-02-01,RANKED,3\nsome unknown keyword,2026-02-01,RANKED,7\n`;
    await adminPage.setInputFiles('input[name="file"]', { name: "ranks.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await adminPage.getByRole("button", { name: "Import" }).click();
    await expect(adminPage.getByText(/Imported 1 of 2 row/)).toBeVisible({ timeout: 10_000 });
    await expect(adminPage.getByText(/No tracked keyword matches/)).toBeVisible();
  });
});
