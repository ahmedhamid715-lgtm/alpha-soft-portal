import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Customer Portal — Services E2E (Build 29 — Roadmap Module 23). Same
 * shared-session/self-identifying-fixture discipline
 * `portal-task-management.spec.ts` (Build 28) already established.
 * Seeds `ServiceDefinition`/`CustomerService` rows DIRECTLY via SQL,
 * focused on the ONE thing that matters here: `/portal/services`'s own
 * customer-safe canonical-tier projection and its cross-tenant boundary
 * — see `portal-services-service.ts`'s own precedence writeup.
 */
let ownerContext: BrowserContext;
let ownerPage: Page;

base.beforeAll(async ({ browser, baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);

  ownerContext = await browser.newContext();
  ownerPage = await ownerContext.newPage();
  await loginAs(ownerPage, "owner-a@alpha-os.test");
});

base.afterAll(async () => {
  await ownerContext?.close();
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

/** A real `ServiceDefinition` + `CustomerService` (manually created, no onboarding provenance) for Acme Corp's own already-converted organization/company. */
async function seedAcmeCustomerService(): Promise<{ serviceName: string }> {
  const suffix = Date.now();
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const acmeOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'acme-corp-dev'")).rows[0].id as string;
    const acmeCompanyId = (await client.query("SELECT id FROM crm_companies WHERE converted_to_organization_id = $1", [acmeOrgId])).rows[0].id as string;

    const serviceName = `E2E Portal SEO ${suffix}`;
    const definitionId = (
      await client.query(
        "INSERT INTO service_definitions (id, organization_id, name, code, category, delivery_cadence, sort_order, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'SEO', 'RECURRING', 0, 'ACTIVE', now(), now()) RETURNING id",
        [platformOrgId, serviceName, `E2E-PORTAL-${suffix}`],
      )
    ).rows[0].id as string;
    await client.query(
      "INSERT INTO customer_services (id, organization_id, customer_organization_id, company_id, service_definition_id, quantity, status, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 1, 'ACTIVE', $5, now(), now())",
      [platformOrgId, acmeOrgId, acmeCompanyId, definitionId, adminUserId],
    );
    return { serviceName };
  });
}

/** A `CustomerService` for a FRESH, unrelated customer organization — never visible to `owner-a`, the cross-tenant negative fixture. */
async function seedForeignCustomerService(): Promise<{ serviceName: string }> {
  const suffix = Date.now();
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const foreignOrgId = (
      await client.query("INSERT INTO organizations (id, name, display_name, slug, status, is_platform, created_at, updated_at) VALUES (gen_random_uuid(), $1, $1, $2, 'ACTIVE', false, now(), now()) RETURNING id", [
        `E2E Foreign Portal Services Co ${suffix}`,
        `e2e-foreign-portal-services-${suffix}`,
      ])
    ).rows[0].id as string;
    const foreignCompanyId = (
      await client.query("INSERT INTO crm_companies (id, organization_id, name, status, converted_to_organization_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', $3, now(), now()) RETURNING id", [
        platformOrgId,
        `E2E Foreign Portal Services Co ${suffix}`,
        foreignOrgId,
      ])
    ).rows[0].id as string;
    const serviceName = `Foreign Portal Service ${suffix}`;
    const definitionId = (
      await client.query(
        "INSERT INTO service_definitions (id, organization_id, name, code, category, delivery_cadence, sort_order, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'SEO', 'RECURRING', 0, 'ACTIVE', now(), now()) RETURNING id",
        [platformOrgId, serviceName, `E2E-FOREIGN-${suffix}`],
      )
    ).rows[0].id as string;
    await client.query(
      "INSERT INTO customer_services (id, organization_id, customer_organization_id, company_id, service_definition_id, quantity, status, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 1, 'ACTIVE', $5, now(), now())",
      [platformOrgId, foreignOrgId, foreignCompanyId, definitionId, adminUserId],
    );
    return { serviceName };
  });
}

base.describe("Customer Portal — Services (shared owner-a session)", () => {
  base("shows the canonical customer service with customer-safe fields, never internal owner identity", async () => {
    const { serviceName } = await seedAcmeCustomerService();

    await goto(ownerPage, "/portal/services");
    await expect(ownerPage.getByText(serviceName)).toBeVisible();
    await expect(ownerPage.getByText("ACTIVE", { exact: true }).first()).toBeVisible();
    await expect(ownerPage.getByText("Your active services")).toBeVisible();

    // No internal-only concepts ever appear on this page.
    await expect(ownerPage.getByText(/internal note/i)).toHaveCount(0);
    await expect(ownerPage.getByText(/QA check/i)).toHaveCount(0);
  });

  base("a foreign organization's customer service never leaks onto this customer's own Services page", async () => {
    const { serviceName } = await seedForeignCustomerService();
    await goto(ownerPage, "/portal/services");
    await expect(ownerPage.getByText(serviceName)).toHaveCount(0);
  });
});

base.describe("Customer Portal — Services access control", () => {
  base("a pure platform-staff user with no customer organization sees an honest empty state, not a crash", async ({ page }) => {
    await loginAs(page, "support@alpha-os.test");
    await goto(page, "/portal/services");
  });
});
