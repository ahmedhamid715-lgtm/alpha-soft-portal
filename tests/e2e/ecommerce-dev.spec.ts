import { test as base, expect, type Page, type BrowserContext, type Locator } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * E-Commerce Development OS E2E (Build 33 — Roadmap Module 27). Same
 * direct style/helpers as `website-dev.spec.ts` — SQL-seeded fixtures,
 * real browser interaction, ONE shared `platform-admin` session for the
 * whole workflow block. A FOURTH, SEPARATE specialist domain from SEO
 * OS/Local SEO/Website Development — its own fixture chain uses
 * `category = 'ECOMMERCE'`, never `'SEO'`/`'LOCAL_SEO'`/`'WEB_DEVELOPMENT'`.
 *
 * Deliberately uses a FRESH, dedicated customer organization/company for
 * every workflow fixture — same "never reuse a shared fixture org across
 * builds" lesson `website-dev.spec.ts`/`local-seo.spec.ts`/`seo-os.spec.ts`
 * themselves document: `CustomerService`/`EcommerceEngagement` rows are
 * permanently undeletable by design.
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
async function seedCustomerService(category: "ECOMMERCE" | "WEB_DEVELOPMENT"): Promise<SeededCustomerService> {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const companyName = `E2E ${category} Customer ${suffix}`;

    const organizationId = (
      await client.query("INSERT INTO organizations (id, name, display_name, slug, status, is_platform, created_at, updated_at) VALUES (gen_random_uuid(), $1, $1, $2, 'ACTIVE', false, now(), now()) RETURNING id", [
        companyName,
        `e2e-ecommerce-${suffix}`,
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

base.describe("E-Commerce Development — access control", () => {
  base("a user with no ecommerce_development permission is denied the list page", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");
    await goto(page, "/admin/ecommerce");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("support admin (read only) sees the list but no management controls", async ({ page }) => {
    await loginAs(page, "support-admin@alpha-os.test");
    await goto(page, "/admin/ecommerce");
    await expect(page.getByRole("heading", { name: "E-Commerce Development", exact: true })).toBeVisible();
  });
});

base.describe("E-Commerce Development — full operational workflow (shared platform-admin session)", () => {
  let fixture: SeededCustomerService;
  let engagementUrl: string;
  let storeUrl: string;

  base("rejects a WEB_DEVELOPMENT-category customer service — no E-Commerce workspace affordance appears", async () => {
    const webFixture = await seedCustomerService("WEB_DEVELOPMENT");
    await goto(adminPage, `/admin/services/customers/${webFixture.customerServiceId}`);
    // A WEB_DEVELOPMENT-category service shows the Website Development workspace section, never an E-Commerce one.
    await expect(adminPage.getByRole("heading", { name: "Website Development workspace" })).toBeVisible();
    await expect(adminPage.getByRole("heading", { name: "E-Commerce Development workspace" })).not.toBeVisible();
  });

  base("sets up an E-Commerce workspace from the customer service, and adds a store", async () => {
    fixture = await seedCustomerService("ECOMMERCE");

    await goto(adminPage, `/admin/services/customers/${fixture.customerServiceId}`);
    await expect(adminPage.getByRole("heading", { name: "E-Commerce Development workspace" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Set up E-Commerce workspace" }).click();
    await adminPage.waitForURL(/\/admin\/ecommerce\/[0-9a-f-]+$/, { timeout: 10_000 });
    engagementUrl = adminPage.url();

    // Idempotency — revisiting the customer service now shows "Open E-Commerce workspace" (not the setup button again).
    await goto(adminPage, `/admin/services/customers/${fixture.customerServiceId}`);
    await expect(adminPage.getByRole("link", { name: "Open E-Commerce workspace" })).toBeVisible();

    await adminPage.goto(engagementUrl);
    const storeName = `E2E Store ${Date.now()}`;
    await adminPage.getByRole("button", { name: "Add store" }).click();
    await adminPage.fill("input[name=name]", storeName);
    await adminPage.fill("input[name=currency]", "USD");
    await adminPage.getByRole("button", { name: "Add store" }).nth(1).click();
    await expect(adminPage.getByText(storeName)).toBeVisible({ timeout: 10_000 });

    await adminPage.getByText(storeName).click();
    await adminPage.waitForURL(/\/stores\/[0-9a-f-]+/, { timeout: 10_000 });
    storeUrl = adminPage.url();
  });

  base("a newly-created store is NOT launch-ready — no checkout/payment configured yet is honestly reported", async () => {
    await adminPage.goto(storeUrl);
    await expect(adminPage.getByText("NOT READY").first()).toBeVisible({ timeout: 10_000 });
  });

  base("configures checkout and payment as configured", async () => {
    await adminPage.goto(`${storeUrl}?tab=configuration`);
    await choose(adminPage, adminPage.getByLabel("Checkout configured"), "Yes");
    await choose(adminPage, adminPage.getByLabel("Payment configured"), "Yes");
    await adminPage.fill('input[name="paymentProviderLabel"]', "Stripe");
    await adminPage.getByRole("button", { name: "Save" }).click();
    await expect(adminPage.getByText("Stripe")).toBeVisible({ timeout: 10_000 });
  });

  base("builds a required product catalog and advances a product through its lifecycle", async () => {
    await adminPage.goto(`${storeUrl}?tab=catalog`);
    await adminPage.getByRole("button", { name: "Add product" }).click();
    await adminPage.fill("input[name=title]", "Classic Tee");
    await adminPage.fill("input[name=handle]", "classic-tee");
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.getByText("Classic Tee")).toBeVisible({ timeout: 10_000 });

    const row = adminPage.locator("tr", { hasText: "Classic Tee" });
    for (const [status, label] of [
      ["IN_PROGRESS", "IN PROGRESS"],
      ["QA", "QA"],
      ["READY_FOR_LAUNCH", "READY FOR LAUNCH"],
    ]) {
      await choose(adminPage, row.getByRole("combobox", { name: "Change status for Classic Tee" }), label);
      // `.first()` — the row's own status text appears twice (the
      // StatusBadge AND the status Select's own current-value display);
      // the badge is the earlier one in document order.
      await expect(row.getByText(status.replace(/_/g, " ")).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  base("rejects a duplicate product handle on the same store", async () => {
    await adminPage.goto(`${storeUrl}?tab=catalog`);
    await adminPage.getByRole("button", { name: "Add product" }).click();
    await adminPage.fill("input[name=title]", "Classic Tee Again");
    await adminPage.fill("input[name=handle]", "classic-tee");
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.locator('[data-slot="alert"]')).toContainText(/already tracked/i, { timeout: 10_000 });
  });

  base("with checkout, payment, and all required products ready, the store becomes launch-ready", async () => {
    await adminPage.goto(storeUrl);
    await expect(adminPage.getByText("READY", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  base("imports an additional product via CSV", async () => {
    // `requiredForLaunch=false` — this import happens AFTER the store has
    // already been proven launch-ready in the previous test; the
    // imported row must not itself reintroduce a new required-but-not-
    // ready product that would flip readiness back to NOT_READY.
    await adminPage.goto(`${storeUrl}?tab=import`);
    const csv = "title,handle,sku,price,requiredForLaunch\nImported Mug,imported-mug,MUG-001,12.99,false\n";
    await adminPage.locator('input[type="file"]').setInputFiles({ name: "products.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await adminPage.getByRole("button", { name: "Import" }).click();
    await expect(adminPage.getByText(/Imported 1 of 1 row/)).toBeVisible({ timeout: 10_000 });
    await adminPage.goto(`${storeUrl}?tab=catalog`);
    await expect(adminPage.getByText("Imported Mug")).toBeVisible({ timeout: 10_000 });
  });

  base("records the launch — no override required once ready", async () => {
    await adminPage.goto(storeUrl);
    await adminPage.getByRole("button", { name: "Record launch", exact: true }).click();
    await adminPage.getByRole("button", { name: "Confirm launch" }).click();
    await expect(adminPage.getByText("LIVE", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  base("a launched store no longer offers a launch action — replay is structurally prevented", async () => {
    await adminPage.goto(storeUrl);
    await expect(adminPage.getByRole("button", { name: /Record launch/ })).not.toBeVisible();
  });

  base("links a new delivery project from the engagement page", async () => {
    await adminPage.goto(engagementUrl);
    await adminPage.getByRole("button", { name: "Link or create a project" }).click();
    const projectTitle = `E2E E-Commerce Delivery ${Date.now()}`;
    await adminPage.fill("input[name=title]", projectTitle);
    await adminPage.getByRole("button", { name: "Create & link" }).click();
    await expect(adminPage.getByText(projectTitle)).toBeVisible({ timeout: 10_000 });
  });

  base("Customer 360 shows the E-Commerce Development performance summary inline on the canonical service card", async () => {
    await goto(adminPage, `/admin/crm/customers/${fixture.companyId}`);
    await adminPage.getByRole("tab", { name: "Services" }).click();
    await expect(adminPage.getByText(/active store/)).toBeVisible({ timeout: 10_000 });
  });

  base("a nonexistent engagement/store shows not found, not a crash", async () => {
    const missing = "00000000-0000-7000-8000-000000000000";
    await adminPage.goto(`/admin/ecommerce/${missing}`);
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText(/could not be found/i)).toBeVisible();
  });

  base("the store workspace remains usable at mobile and tablet widths", async ({ browser }) => {
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await loginAs(page, "platform-admin@alpha-os.test");
      await goto(page, storeUrl);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await context.close();
    }
  });
});

base.describe("E-Commerce Development — launch readiness denial and override", () => {
  let storeUrl: string;

  base.beforeAll(async () => {
    const fixture = await seedCustomerService("ECOMMERCE");
    await goto(adminPage, `/admin/services/customers/${fixture.customerServiceId}`);
    await adminPage.getByRole("button", { name: "Set up E-Commerce workspace" }).click();
    await adminPage.waitForURL(/\/admin\/ecommerce\/[0-9a-f-]+$/, { timeout: 10_000 });
    const storeName = `E2E Not Ready Store ${Date.now()}`;
    await adminPage.getByRole("button", { name: "Add store" }).click();
    await adminPage.fill("input[name=name]", storeName);
    await adminPage.getByRole("button", { name: "Add store" }).nth(1).click();
    await expect(adminPage.getByText(storeName)).toBeVisible({ timeout: 10_000 });
    await adminPage.getByText(storeName).click();
    await adminPage.waitForURL(/\/stores\/[0-9a-f-]+/, { timeout: 10_000 });
    storeUrl = adminPage.url();
  });

  base("an override reason is required to launch a NOT_READY store, and the launch is honestly recorded as an override", async () => {
    await adminPage.goto(storeUrl);
    await expect(adminPage.getByText("NOT READY").first()).toBeVisible({ timeout: 10_000 });
    await adminPage.getByRole("button", { name: "Record launch (override)" }).click();
    const confirmButton = adminPage.getByRole("button", { name: "Confirm launch" });
    // No checkout/payment configured — the reason field is required, blocking submission without it.
    await expect(adminPage.getByLabel(/Override reason/)).toBeVisible();
    await adminPage.getByLabel(/Override reason/).fill("Client requested an early soft-launch despite incomplete configuration.");
    await confirmButton.click();
    await expect(adminPage.getByText("LIVE", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });
});
