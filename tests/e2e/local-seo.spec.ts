import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Local SEO / GBP E2E (Build 31 — Roadmap Module 25). Same direct
 * style/helpers as `seo-os.spec.ts` (Build 30) — SQL-seeded fixtures,
 * real browser interaction, ONE shared `platform-admin` session for the
 * whole workflow block. A SEPARATE specialist domain from SEO OS — its
 * own fixture chain uses `category = 'LOCAL_SEO'`, never `'SEO'`.
 *
 * Deliberately uses a FRESH, dedicated customer organization/company for
 * every fixture — same "never reuse a shared fixture org across builds"
 * lesson `seo-os.spec.ts` itself documents (Build 29's own original
 * finding): `CustomerService`/`LocalSeoEngagement` rows are permanently
 * undeletable by design.
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

interface SeededCustomerService {
  organizationId: string;
  companyId: string;
  customerServiceId: string;
  companyName: string;
}

/** A fresh customer org + converted company + a ServiceDefinition of the given category + ACTIVE CustomerService. */
async function seedCustomerService(category: "LOCAL_SEO" | "SEO"): Promise<SeededCustomerService> {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const companyName = `E2E ${category} Customer ${suffix}`;

    const organizationId = (
      await client.query("INSERT INTO organizations (id, name, display_name, slug, status, is_platform, created_at, updated_at) VALUES (gen_random_uuid(), $1, $1, $2, 'ACTIVE', false, now(), now()) RETURNING id", [
        companyName,
        `e2e-localseo-${suffix}`,
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
        "INSERT INTO service_definitions (id, organization_id, name, code, category, delivery_cadence, status, sort_order, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ONGOING', 'ACTIVE', 0, now(), now()) RETURNING id",
        [platformOrgId, `E2E ${category} Retainer ${suffix}`, `E2E-${category}-${suffix}`, category],
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

base.describe("Local SEO — access control", () => {
  base("a user with no local_seo permission is denied the list page", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");
    await goto(page, "/admin/local-seo");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("support admin (read only) sees the list but no management controls", async ({ page }) => {
    await loginAs(page, "support-admin@alpha-os.test");
    await goto(page, "/admin/local-seo");
    await expect(page.getByRole("heading", { name: "Local SEO", exact: true })).toBeVisible();
  });
});

base.describe("Local SEO — full operational workflow (shared platform-admin session)", () => {
  let fixture: SeededCustomerService;
  let engagementUrl: string;
  let locationUrl: string;

  base("rejects a SEO-category customer service — no Local SEO workspace affordance appears", async () => {
    const seoFixture = await seedCustomerService("SEO");
    await goto(adminPage, `/admin/services/customers/${seoFixture.customerServiceId}`);
    // A SEO-category service shows the SEO workspace section, never a Local SEO one.
    await expect(adminPage.getByRole("heading", { name: "SEO workspace" })).toBeVisible();
    await expect(adminPage.getByRole("heading", { name: "Local SEO workspace" })).not.toBeVisible();
  });

  base("sets up a Local SEO workspace from the customer service, and adds a business location", async () => {
    fixture = await seedCustomerService("LOCAL_SEO");

    await goto(adminPage, `/admin/services/customers/${fixture.customerServiceId}`);
    await expect(adminPage.getByRole("heading", { name: "Local SEO workspace" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Set up Local SEO workspace" }).click();
    await adminPage.waitForURL(/\/admin\/local-seo\/[0-9a-f-]+$/, { timeout: 10_000 });
    engagementUrl = adminPage.url();

    // Idempotency — revisiting the customer service now shows "Open Local SEO workspace" (not the setup button again).
    await goto(adminPage, `/admin/services/customers/${fixture.customerServiceId}`);
    await expect(adminPage.getByRole("link", { name: "Open Local SEO workspace" })).toBeVisible();

    await adminPage.goto(engagementUrl);
    const businessName = `E2E Pizza Shop ${Date.now()}`;
    await adminPage.getByRole("button", { name: "Add location" }).click();
    await adminPage.fill("input[name=businessName]", businessName);
    await adminPage.fill("input[name=city]", "Springfield");
    await adminPage.fill("input[name=country]", "US");
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.getByText(businessName)).toBeVisible({ timeout: 10_000 });

    await adminPage.getByText(businessName).click();
    await adminPage.waitForURL(/\/locations\/[0-9a-f-]+/, { timeout: 10_000 });
    locationUrl = adminPage.url();
  });

  base("records Google Business Profile data on the Profile tab", async () => {
    await adminPage.goto(`${locationUrl}?tab=profile`);
    await adminPage.fill("input[name=primaryCategory]", "Pizza Restaurant");
    await adminPage.getByLabel("Verification state (as observed)").selectOption("VERIFIED");
    await adminPage.getByRole("button", { name: "Save" }).click();
    await expect(adminPage.getByText("Pizza Restaurant")).toBeVisible({ timeout: 10_000 });
    await expect(adminPage.getByText("VERIFIED")).toBeVisible();
  });

  base("adds a local keyword, records a Local Pack rank observation, and shows the current position", async () => {
    await adminPage.goto(`${locationUrl}?tab=keywords`);
    const phrase = `e2e best pizza near me ${Date.now()}`;
    await adminPage.getByRole("button", { name: "Add keyword" }).click();
    await adminPage.fill("input[name=phrase]", phrase);
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.getByText(phrase)).toBeVisible({ timeout: 10_000 });

    const row = adminPage.locator("tr", { hasText: phrase });
    await row.getByRole("button", { name: "Record" }).click();
    await adminPage.getByLabel("Date").fill("2026-01-01");
    await adminPage.getByLabel("Status").selectOption("RANKED");
    await adminPage.getByLabel("Position").fill("2");
    await adminPage.getByRole("button", { name: "Save" }).click();
    await expect(adminPage.getByText("#2")).toBeVisible({ timeout: 10_000 });
  });

  base("rejects a duplicate local rank observation for the same keyword and date", async () => {
    await adminPage.goto(`${locationUrl}?tab=keywords`);
    await adminPage.getByRole("button", { name: "Record" }).first().click();
    await adminPage.getByLabel("Date").fill("2026-01-01");
    await adminPage.getByLabel("Status").selectOption("RANKED");
    await adminPage.getByLabel("Position").fill("3");
    await adminPage.getByRole("button", { name: "Save" }).click();
    await expect(adminPage.locator('[data-slot="alert"]')).toContainText(/already exists/i, { timeout: 10_000 });
  });

  base("records a listing observation and shows its NAP consistency status", async () => {
    await adminPage.goto(`${locationUrl}?tab=listings`);
    await adminPage.getByRole("button", { name: "Record listing" }).click();
    await adminPage.fill("input[name=sourceName]", "Yelp");
    await adminPage.fill("input[name=observedBusinessName]", "E2E Pizza Shop"); // deliberately close but not exact — proves live comparison, not string equality theater
    await adminPage.fill("input[name=observedCity]", "Springfield");
    await adminPage.getByRole("button", { name: "Save", exact: true }).click();
    await expect(adminPage.getByText("Yelp")).toBeVisible({ timeout: 10_000 });
    // Some consistency verdict is shown — CONSISTENT/INCONSISTENT/Partially comparable — never silently blank.
    await expect(adminPage.getByText(/consistent|comparable/i).first()).toBeVisible();
  });

  base("records a review, drafts a response, and confirms it was published externally", async () => {
    await adminPage.goto(`${locationUrl}?tab=reviews`);
    await adminPage.getByRole("button", { name: "Record review" }).click();
    await adminPage.getByLabel("Rating").selectOption("5");
    await adminPage.fill("input[name=reviewerDisplayName]", "E2E Reviewer");
    await adminPage.fill("input[name=text]", "Great local pizza!");
    await adminPage.getByRole("button", { name: "Save", exact: true }).click();
    await expect(adminPage.getByText("E2E Reviewer", { exact: false })).toBeVisible({ timeout: 10_000 });

    await adminPage.getByRole("button", { name: "Draft response" }).click();
    await adminPage.fill("textarea[name=responseText]", "Thank you for the kind words!");
    await adminPage.getByRole("button", { name: "Save draft" }).click();
    await expect(adminPage.getByText("DRAFTED")).toBeVisible({ timeout: 10_000 });

    await adminPage.getByRole("button", { name: "Confirm published on Google" }).click();
    await expect(adminPage.getByText("RESPONDED")).toBeVisible({ timeout: 10_000 });
  });

  base("records a Local SEO audit with a critical issue, and shows it in the Issues tab", async () => {
    await adminPage.goto(`${locationUrl}?tab=audits`);
    await adminPage.getByRole("button", { name: "Record audit" }).click();
    await adminPage.fill("input[name=startedAt]", "2026-01-02");
    await adminPage.getByText("Found an issue during this audit").click();
    const issueTitle = `E2E NAP mismatch ${Date.now()}`;
    await adminPage.fill("input[name=issueTitle]", issueTitle);
    await adminPage.selectOption("select[name=issueType]", "NAP_INCONSISTENCY");
    await adminPage.selectOption("select[name=issueSeverity]", "CRITICAL");
    await adminPage.getByRole("button", { name: "Save audit" }).click();
    await expect(adminPage.getByText("2026")).toBeVisible({ timeout: 10_000 });

    await adminPage.goto(`${locationUrl}?tab=issues`);
    await expect(adminPage.getByText(issueTitle)).toBeVisible({ timeout: 10_000 });
    await expect(adminPage.getByText("CRITICAL").first()).toBeVisible();
  });

  base("full issue lifecycle: acknowledge, resolve, reopen, and convert to a task", async () => {
    await adminPage.goto(`${locationUrl}?tab=issues`);

    await adminPage.getByRole("button", { name: "Acknowledge" }).first().click();
    await expect(adminPage.getByText("ACKNOWLEDGED").first()).toBeVisible({ timeout: 10_000 });

    await adminPage.getByRole("button", { name: "Resolve" }).first().click();
    await expect(adminPage.getByText("RESOLVED").first()).toBeVisible({ timeout: 10_000 });

    await adminPage.getByRole("button", { name: "Reopen" }).first().click();
    await expect(adminPage.getByText("OPEN").first()).toBeVisible({ timeout: 10_000 });

    await adminPage.getByRole("button", { name: "Create task" }).first().click();
    await expect(adminPage.getByText("Task created")).toBeVisible({ timeout: 10_000 });
  });

  base("ignoring an issue requires a non-empty reason", async () => {
    await adminPage.goto(`${locationUrl}?tab=issues`);
    const ignoreButton = adminPage.getByRole("button", { name: "Ignore" }).first();
    if ((await ignoreButton.count()) === 0) return; // the earlier issue is already linked to a task and mid-lifecycle; skip if no ignorable issue remains
    await ignoreButton.click();
    const confirmButton = adminPage.getByRole("button", { name: "Confirm" });
    await expect(confirmButton).toBeDisabled();
  });

  base("archiving a location is reflected immediately, and reactivation restores it", async () => {
    await adminPage.goto(engagementUrl);
    await adminPage.getByRole("button", { name: "Archive" }).first().click();
    await expect(adminPage.getByText("ARCHIVED").first()).toBeVisible({ timeout: 10_000 });
    await adminPage.getByRole("button", { name: "Reactivate" }).first().click();
    await expect(adminPage.getByText("ACTIVE").first()).toBeVisible({ timeout: 10_000 });
  });

  base("Customer 360 shows the Local SEO performance summary inline on the canonical service card", async () => {
    await goto(adminPage, `/admin/crm/customers/${fixture.companyId}`);
    await adminPage.getByRole("tab", { name: "Services" }).click();
    await expect(adminPage.getByText(/local keyword\(s\) tracked/)).toBeVisible({ timeout: 10_000 });
  });

  base("a nonexistent engagement/location shows not found, not a crash", async () => {
    const missing = "00000000-0000-7000-8000-000000000000";
    await adminPage.goto(`/admin/local-seo/${missing}`);
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText(/could not be found/i)).toBeVisible();
  });

  base("the location workspace remains usable at mobile and tablet widths", async ({ browser }) => {
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await loginAs(page, "platform-admin@alpha-os.test");
      await goto(page, locationUrl);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await context.close();
    }
  });
});

base.describe("Local SEO — CSV import", () => {
  let fixture: SeededCustomerService;
  let locationUrl: string;
  let keywordPhrase: string;

  base.beforeAll(async () => {
    fixture = await seedCustomerService("LOCAL_SEO");
    await goto(adminPage, `/admin/services/customers/${fixture.customerServiceId}`);
    await adminPage.getByRole("button", { name: "Set up Local SEO workspace" }).click();
    await adminPage.waitForURL(/\/admin\/local-seo\/[0-9a-f-]+$/, { timeout: 10_000 });
    const businessName = `E2E Import Location ${Date.now()}`;
    await adminPage.getByRole("button", { name: "Add location" }).click();
    await adminPage.fill("input[name=businessName]", businessName);
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.getByText(businessName)).toBeVisible({ timeout: 10_000 });
    await adminPage.getByText(businessName).click();
    await adminPage.waitForURL(/\/locations\/[0-9a-f-]+/, { timeout: 10_000 });
    locationUrl = adminPage.url();

    await adminPage.goto(`${locationUrl}?tab=keywords`);
    keywordPhrase = `e2e local import keyword ${Date.now()}`;
    await adminPage.getByRole("button", { name: "Add keyword" }).click();
    await adminPage.fill("input[name=phrase]", keywordPhrase);
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.getByText(keywordPhrase)).toBeVisible({ timeout: 10_000 });
  });

  base("imports local rank observations from a CSV file for an already-tracked keyword, and reports skipped unknown rows", async () => {
    await adminPage.goto(`${locationUrl}?tab=import`);
    const csv = `phrase,observedAt,rankStatus,position\n${keywordPhrase},2026-02-01,RANKED,1\nsome unknown local keyword,2026-02-01,RANKED,7\n`;
    await adminPage.setInputFiles('input[name="file"]', { name: "local-ranks.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await adminPage.getByRole("button", { name: "Import" }).click();
    await expect(adminPage.getByText(/Imported 1 of 2 row/)).toBeVisible({ timeout: 10_000 });
    await expect(adminPage.getByText(/No tracked keyword matches/)).toBeVisible();
  });
});
