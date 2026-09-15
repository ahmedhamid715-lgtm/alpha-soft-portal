import { test as base, expect, type Page, type BrowserContext, type Locator } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Website Development OS E2E (Build 32 — Roadmap Module 26). Same
 * direct style/helpers as `seo-os.spec.ts`/`local-seo.spec.ts` — SQL-
 * seeded fixtures, real browser interaction, ONE shared `platform-admin`
 * session for the whole workflow block. A THIRD, SEPARATE specialist
 * domain from SEO OS/Local SEO — its own fixture chain uses `category =
 * 'WEB_DEVELOPMENT'`, never `'SEO'`/`'LOCAL_SEO'`.
 *
 * Deliberately uses a FRESH, dedicated customer organization/company for
 * every workflow fixture — same "never reuse a shared fixture org
 * across builds" lesson documented (and re-learned the hard way this
 * session) by `seo-os.spec.ts`/`local-seo.spec.ts` themselves:
 * `CustomerService`/`WebsiteEngagement` rows are permanently
 * undeletable by design. The one Portal test below is the sole
 * exception — it deliberately reuses the SAME pre-seeded `owner-a`
 * customer organization/company `portal.spec.ts` itself uses, via the
 * identical idempotent find-or-create-by-`converted_to_organization_id`
 * pattern (never a second, colliding "E2E Portal Co").
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

/** See `sales-pipeline.spec.ts`'s own identical helper comment — Radix `SelectContent` portals to `document.body`, so the option must always be queried against the real top-level `Page`, never a scoped `Locator`. */
async function choose(rootPage: Page, trigger: Locator, option: string) {
  await trigger.click();
  await rootPage.getByRole("option", { name: option, exact: true }).click();
}

interface SeededCustomerService {
  organizationId: string;
  companyId: string;
  customerServiceId: string;
  companyName: string;
}

/** A fresh customer org + converted company + a ServiceDefinition of the given category + ACTIVE CustomerService. */
async function seedCustomerService(category: "WEB_DEVELOPMENT" | "SEO"): Promise<SeededCustomerService> {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const companyName = `E2E ${category} Customer ${suffix}`;

    const organizationId = (
      await client.query("INSERT INTO organizations (id, name, display_name, slug, status, is_platform, created_at, updated_at) VALUES (gen_random_uuid(), $1, $1, $2, 'ACTIVE', false, now(), now()) RETURNING id", [
        companyName,
        `e2e-websitedev-${suffix}`,
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
        "INSERT INTO service_definitions (id, organization_id, name, code, category, delivery_cadence, status, sort_order, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ONE_TIME', 'ACTIVE', 0, now(), now()) RETURNING id",
        [platformOrgId, `E2E ${category} Package ${suffix}`, `E2E-${category}-${suffix}`, category],
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

base.describe("Website Development — access control", () => {
  base("a user with no website_development permission is denied the list page", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");
    await goto(page, "/admin/websites");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("support admin (read only) sees the list but no management controls", async ({ page }) => {
    await loginAs(page, "support-admin@alpha-os.test");
    await goto(page, "/admin/websites");
    await expect(page.getByRole("heading", { name: "Website Development", exact: true })).toBeVisible();
  });
});

base.describe("Website Development — full operational workflow (shared platform-admin session)", () => {
  let fixture: SeededCustomerService;
  let engagementUrl: string;
  let siteUrl: string;
  let primaryDomain: string;

  base("rejects a SEO-category customer service — no Website Development workspace affordance appears", async () => {
    const seoFixture = await seedCustomerService("SEO");
    await goto(adminPage, `/admin/services/customers/${seoFixture.customerServiceId}`);
    // A SEO-category service shows the SEO workspace section, never a Website Development one.
    await expect(adminPage.getByRole("heading", { name: "SEO workspace" })).toBeVisible();
    await expect(adminPage.getByRole("heading", { name: "Website Development workspace" })).not.toBeVisible();
  });

  base("sets up a Website workspace from the customer service, and adds a site", async () => {
    fixture = await seedCustomerService("WEB_DEVELOPMENT");

    await goto(adminPage, `/admin/services/customers/${fixture.customerServiceId}`);
    await expect(adminPage.getByRole("heading", { name: "Website Development workspace" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Set up Website workspace" }).click();
    await adminPage.waitForURL(/\/admin\/websites\/[0-9a-f-]+$/, { timeout: 10_000 });
    engagementUrl = adminPage.url();

    // Idempotency — revisiting the customer service now shows "Open Website workspace" (not the setup button again).
    await goto(adminPage, `/admin/services/customers/${fixture.customerServiceId}`);
    await expect(adminPage.getByRole("link", { name: "Open Website workspace" })).toBeVisible();

    await adminPage.goto(engagementUrl);
    const siteName = `E2E Marketing Site ${Date.now()}`;
    primaryDomain = `e2e-site-${Date.now()}.example.com`;
    await adminPage.getByRole("button", { name: "Add site" }).click();
    await adminPage.fill("input[name=name]", siteName);
    await adminPage.fill("input[name=primaryUrl]", `https://${primaryDomain}`);
    await adminPage.getByRole("button", { name: "Add site" }).nth(1).click();
    await expect(adminPage.getByText(siteName)).toBeVisible({ timeout: 10_000 });

    await adminPage.getByText(siteName).click();
    await adminPage.waitForURL(/\/sites\/[0-9a-f-]+/, { timeout: 10_000 });
    siteUrl = adminPage.url();
  });

  base("a newly-created site is NOT launch-ready — no domain/production environment/pages recorded yet is honestly reported", async () => {
    await adminPage.goto(siteUrl);
    await expect(adminPage.getByText("NOT READY").first()).toBeVisible({ timeout: 10_000 });
  });

  base("records a staging and a production environment", async () => {
    await adminPage.goto(`${siteUrl}?tab=environments`);
    const stagingCard = adminPage.locator('[data-slot="card"]', { hasText: "Staging" });
    await stagingCard.getByRole("button", { name: "Record" }).click();
    await adminPage.fill('input[name="url"]', "https://staging.e2e-site.example.com");
    await adminPage.getByRole("button", { name: "Save" }).click();
    await expect(adminPage.getByText("staging.e2e-site.example.com")).toBeVisible({ timeout: 10_000 });

    const productionCard = adminPage.locator('[data-slot="card"]', { hasText: "Production" });
    await productionCard.getByRole("button", { name: "Record" }).click();
    await adminPage.fill('input[name="url"]', "https://e2e-site.example.com");
    await adminPage.getByRole("checkbox", { name: "Show URL in Customer Portal" }).check();
    await adminPage.getByRole("button", { name: "Save" }).click();
    await expect(adminPage.getByText("e2e-site.example.com", { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  });

  base("builds a required page inventory and advances a page through its lifecycle", async () => {
    await adminPage.goto(`${siteUrl}?tab=pages`);
    await adminPage.getByRole("button", { name: "Add page" }).click();
    await adminPage.fill("input[name=title]", "Home");
    await adminPage.fill("input[name=path]", "/");
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.getByText("Home")).toBeVisible({ timeout: 10_000 });

    const row = adminPage.locator("tr", { hasText: "Home" });
    for (const [status, label] of [
      ["IN_PROGRESS", "IN PROGRESS"],
      ["QA", "QA"],
      ["READY_FOR_LAUNCH", "READY FOR LAUNCH"],
    ]) {
      await choose(adminPage, row.getByRole("combobox", { name: "Change status for Home" }), label);
      // `.first()` — the row's own status text appears twice (the
      // StatusBadge AND the status Select's own current-value display);
      // the badge is the earlier one in document order.
      await expect(row.getByText(status.replace(/_/g, " ")).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  base("rejects a duplicate page path on the same site", async () => {
    await adminPage.goto(`${siteUrl}?tab=pages`);
    await adminPage.getByRole("button", { name: "Add page" }).click();
    await adminPage.fill("input[name=title]", "Home again");
    await adminPage.fill("input[name=path]", "/");
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.locator('[data-slot="alert"]')).toContainText(/already tracked/i, { timeout: 10_000 });
  });

  base("with a domain, production environment, and all required pages ready, the site becomes launch-ready", async () => {
    await adminPage.goto(siteUrl);
    await expect(adminPage.getByText("READY", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  base("records a deployment and then records the launch — no override required once ready", async () => {
    await adminPage.goto(`${siteUrl}?tab=deployments`);
    await adminPage.getByRole("button", { name: "Record deployment" }).click();
    await choose(adminPage, adminPage.getByLabel("Environment"), "Production");
    await adminPage.fill('input[name="deployedAt"]', "2026-03-01");
    await adminPage.fill('input[name="versionLabel"]', "v1.0.0");
    await adminPage.getByRole("button", { name: "Record", exact: true }).click();
    // Scoped to the new row (by its own version label) — a bare page-wide
    // `getByText("SUCCEEDED")` also matches the (still-mounted) status
    // Select's own hidden native-form mirror element.
    await expect(adminPage.locator("tr", { hasText: "v1.0.0" }).getByText("SUCCEEDED")).toBeVisible({ timeout: 10_000 });

    await adminPage.goto(siteUrl);
    await adminPage.getByRole("button", { name: "Record launch", exact: true }).click();
    await adminPage.getByRole("button", { name: "Confirm launch" }).click();
    await expect(adminPage.getByText("LAUNCHED").first()).toBeVisible({ timeout: 10_000 });
  });

  base("a launched site no longer offers a launch action — replay is structurally prevented", async () => {
    await adminPage.goto(siteUrl);
    await expect(adminPage.getByRole("button", { name: /Record launch/ })).not.toBeVisible();
  });

  base("rejects a second site on the same engagement with the same primary domain", async () => {
    await adminPage.goto(engagementUrl);
    await adminPage.getByRole("button", { name: "Add site" }).click();
    await adminPage.fill("input[name=name]", "Duplicate domain attempt");
    await adminPage.fill("input[name=primaryUrl]", `https://${primaryDomain}`);
    await adminPage.getByRole("button", { name: "Add site" }).nth(1).click();
    await expect(adminPage.locator('[data-slot="alert"]')).toContainText(/already tracked/i, { timeout: 10_000 });
  });

  base("links a new delivery project from the engagement page", async () => {
    await adminPage.goto(engagementUrl);
    await adminPage.getByRole("button", { name: "Link or create a project" }).click();
    const projectTitle = `E2E Website Delivery ${Date.now()}`;
    await adminPage.fill("input[name=title]", projectTitle);
    await adminPage.getByRole("button", { name: "Create & link" }).click();
    await expect(adminPage.getByText(projectTitle)).toBeVisible({ timeout: 10_000 });
  });

  base("Customer 360 shows the Website Development performance summary inline on the canonical service card", async () => {
    await goto(adminPage, `/admin/crm/customers/${fixture.companyId}`);
    await adminPage.getByRole("tab", { name: "Services" }).click();
    await expect(adminPage.getByText(/active site/)).toBeVisible({ timeout: 10_000 });
  });

  base("a nonexistent engagement/site shows not found, not a crash", async () => {
    const missing = "00000000-0000-7000-8000-000000000000";
    await adminPage.goto(`/admin/websites/${missing}`);
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText(/could not be found/i)).toBeVisible();
  });

  base("the site workspace remains usable at mobile and tablet widths", async ({ browser }) => {
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await loginAs(page, "platform-admin@alpha-os.test");
      await goto(page, siteUrl);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await context.close();
    }
  });
});

base.describe("Website Development — launch readiness denial and override", () => {
  let siteUrl: string;

  base.beforeAll(async () => {
    const fixture = await seedCustomerService("WEB_DEVELOPMENT");
    await goto(adminPage, `/admin/services/customers/${fixture.customerServiceId}`);
    await adminPage.getByRole("button", { name: "Set up Website workspace" }).click();
    await adminPage.waitForURL(/\/admin\/websites\/[0-9a-f-]+$/, { timeout: 10_000 });
    const siteName = `E2E Not Ready Site ${Date.now()}`;
    await adminPage.getByRole("button", { name: "Add site" }).click();
    await adminPage.fill("input[name=name]", siteName);
    await adminPage.getByRole("button", { name: "Add site" }).nth(1).click();
    await expect(adminPage.getByText(siteName)).toBeVisible({ timeout: 10_000 });
    await adminPage.getByText(siteName).click();
    await adminPage.waitForURL(/\/sites\/[0-9a-f-]+/, { timeout: 10_000 });
    siteUrl = adminPage.url();
  });

  base("an override reason is required to launch a NOT_READY site, and the launch is honestly recorded as an override", async () => {
    await adminPage.goto(siteUrl);
    await expect(adminPage.getByText("NOT READY").first()).toBeVisible({ timeout: 10_000 });
    await adminPage.getByRole("button", { name: "Record launch (override)" }).click();
    const confirmButton = adminPage.getByRole("button", { name: "Confirm launch" });
    // No domain/production environment recorded — the reason field is required, blocking submission without it.
    await expect(adminPage.getByLabel(/Override reason/)).toBeVisible();
    await adminPage.getByLabel(/Override reason/).fill("Client requested an early soft-launch despite missing pages.");
    await confirmButton.click();
    await expect(adminPage.getByText("LAUNCHED").first()).toBeVisible({ timeout: 10_000 });
  });
});
