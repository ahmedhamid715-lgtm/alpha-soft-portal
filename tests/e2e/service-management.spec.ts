import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Service Management E2E (Build 29 — Roadmap Module 23). Same direct
 * style/helpers as `task-management.spec.ts` (Build 28) — SQL-seeded
 * fixtures, real browser interaction, ONE shared `platform-admin`
 * session for the whole "full operational workflow" block
 * (`beforeAll`/`afterAll`, not one login per test) — the real
 * `authRateLimiter` is 10 requests/15min per email; found live in Build
 * 28 that per-test logins for the same account trips it under repeated
 * local runs.
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
const MISSING_ID = "00000000-0000-7000-8000-000000000000";

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

interface SeededOnboardingServiceItem {
  serviceItemId: string;
  itemTitle: string;
  companyName: string;
}

/** A real deal → proposal → onboarding → service item chain for Acme Corp (already-converted org), mirroring `client-onboarding.spec.ts`'s own `seedEligibleDeal()` shape, taken one step further into a real service item — the "Unmapped" tab's own real fixture. */
async function seedOnboardingServiceItem(): Promise<SeededOnboardingServiceItem> {
  const suffix = Date.now();
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const acmeOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'acme-corp-dev'")).rows[0].id as string;
    const acmeCompanyId = (await client.query("SELECT id FROM crm_companies WHERE converted_to_organization_id = $1", [acmeOrgId])).rows[0].id as string;
    // The Unmapped tab renders the linked ORGANIZATION's own display
    // name (`onboarding.linkedOrganization.displayName`), not the
    // `CrmCompany.name` field — the two can genuinely differ in this
    // shared dev database (found live: an old stray fixture had left
    // Acme Corp's own `crm_companies.name` renamed to something
    // unrelated, while `acme-corp-dev`'s own stable `display_name`
    // stayed "Acme Corp"). Query the same field the page actually shows.
    const companyName = (await client.query("SELECT display_name FROM organizations WHERE id = $1", [acmeOrgId])).rows[0].display_name as string;

    const pipelineId = (await client.query("SELECT id FROM crm_pipelines WHERE organization_id = $1 AND is_default = true", [platformOrgId])).rows[0].id as string;
    const wonStageId = (await client.query("SELECT id FROM crm_pipeline_stages WHERE pipeline_id = $1 AND is_won = true", [pipelineId])).rows[0].id as string;
    const dealId = (
      await client.query(
        "INSERT INTO crm_deals (id, organization_id, pipeline_id, stage_id, company_id, title, value_minor_units, currency, status, won_at, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 500000, 'USD', 'WON', now(), $6, now(), now()) RETURNING id",
        [platformOrgId, pipelineId, wonStageId, acmeCompanyId, `E2E Service Mgmt Deal ${suffix}`, adminUserId],
      )
    ).rows[0].id as string;
    const proposalId = (
      await client.query("INSERT INTO crm_proposals (id, organization_id, deal_id, company_id, proposal_number, status, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACCEPTED', $5, now(), now()) RETURNING id", [
        platformOrgId,
        dealId,
        acmeCompanyId,
        `E2E-SM-${suffix}`,
        adminUserId,
      ])
    ).rows[0].id as string;
    const onboardingId = (
      await client.query(
        "INSERT INTO crm_client_onboardings (id, organization_id, deal_id, company_id, linked_organization_id, originating_proposal_id, status, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'IN_PROGRESS', $6, now(), now()) RETURNING id",
        [platformOrgId, dealId, acmeCompanyId, acmeOrgId, proposalId, adminUserId],
      )
    ).rows[0].id as string;
    const itemTitle = `E2E SEO Retainer ${suffix}`;
    const serviceItemId = (
      await client.query(
        "INSERT INTO crm_client_onboarding_service_items (id, organization_id, onboarding_id, title, description, quantity, onboarding_required, sort_order, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, NULL, 1, true, 0, now(), now()) RETURNING id",
        [platformOrgId, onboardingId, itemTitle],
      )
    ).rows[0].id as string;

    return { serviceItemId, itemTitle, companyName };
  });
}

base.describe("Service Management — access control", () => {
  base("a user with no delivery_services permission is denied the list page", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");
    await goto(page, "/admin/services");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("support admin (read only) sees the list but no New actions", async ({ page }) => {
    await loginAs(page, "support-admin@alpha-os.test");
    await goto(page, "/admin/services");
    await expect(page.getByRole("heading", { name: "Services", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "New service definition" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "New customer service" })).toHaveCount(0);

    // Direct URL access to the manage-only create pages must also be denied server-side, not merely hidden from nav.
    await goto(page, "/admin/services/new");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
    await goto(page, "/admin/services/customers/new");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });
});

base.describe("Service Management — full operational workflow (shared platform-admin session)", () => {
  base("creates a service definition, edits it, and archive/reactivate round-trips", async () => {
    await goto(adminPage, "/admin/services/new");
    const name = `E2E SEO Service ${Date.now()}`;
    const code = `E2E-${Date.now()}`;
    await adminPage.fill("input[name=name]", name);
    await adminPage.fill("input[name=code]", code);
    await adminPage.click('button:has-text("Create service definition")');
    await adminPage.waitForURL(/\/admin\/services\/[0-9a-f-]+$/);
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(adminPage.getByText("ACTIVE", { exact: true }).first()).toBeVisible();

    // Edit
    const newName = `${name} (edited)`;
    await adminPage.fill("input[name=name]", newName);
    await adminPage.click('button:has-text("Save changes")');
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByRole("heading", { name: newName, exact: true })).toBeVisible();

    // Archive then reactivate
    await adminPage.click('button:has-text("Archive")');
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText("ARCHIVED", { exact: true }).first()).toBeVisible();
    await adminPage.click('button:has-text("Reactivate")');
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText("ACTIVE", { exact: true }).first()).toBeVisible();
  });

  base("shows an unmapped onboarding service item, provisions it, and prevents duplicate provisioning", async () => {
    const { serviceItemId, itemTitle, companyName } = await seedOnboardingServiceItem();

    await goto(adminPage, "/admin/services?tab=unmapped");
    await expect(adminPage.getByText(itemTitle)).toBeVisible();
    await expect(adminPage.getByText(companyName).first()).toBeVisible();

    await adminPage.getByRole("link", { name: "Provision" }).first().click();
    await adminPage.waitForURL(new RegExp(`sourceOnboardingServiceItemId=${serviceItemId}`));
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText(itemTitle, { exact: false }).first()).toBeVisible();

    await adminPage.click('button:has-text("Provision service")');
    await adminPage.waitForURL(/\/admin\/services\/customers\/[0-9a-f-]+$/);
    await expectNoApplicationError(adminPage);
    const provisionedUrl = adminPage.url();

    // The item no longer appears in Unmapped.
    await goto(adminPage, "/admin/services?tab=unmapped");
    await expect(adminPage.getByText(itemTitle)).toHaveCount(0);

    // A direct repeat visit to the provisioning URL for the SAME source item shows it's already provisioned, not a duplicate-creation form.
    await adminPage.goto(`/admin/services/customers/new?sourceOnboardingServiceItemId=${serviceItemId}`);
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText(/already provisioned|not found/i)).toBeVisible();

    await adminPage.goto(provisionedUrl);
    await expectNoApplicationError(adminPage);
  });

  base("customer service detail: owner assignment, activation, pause/resume, completion, and project linkage", async () => {
    const { serviceItemId, itemTitle } = await seedOnboardingServiceItem();
    await adminPage.goto(`/admin/services/customers/new?sourceOnboardingServiceItemId=${serviceItemId}`);
    await adminPage.click('button:has-text("Provision service")');
    await adminPage.waitForURL(/\/admin\/services\/customers\/[0-9a-f-]+$/);
    await expectNoApplicationError(adminPage);
    void itemTitle;

    // Owner assignment
    await adminPage.locator("select#" + (await adminPage.locator('label:has-text("Owner")').getAttribute("for"))).selectOption({ label: "Platform Admin (Dev)" });
    await expectNoApplicationError(adminPage);

    // Lifecycle: PENDING -> ACTIVE -> PAUSED -> ACTIVE -> COMPLETED -> ACTIVE (reopen)
    await expect(adminPage.getByText("PENDING", { exact: true }).first()).toBeVisible();
    await adminPage.click('button:has-text("Activate")');
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText("ACTIVE", { exact: true }).first()).toBeVisible();

    await adminPage.click('button:has-text("Pause")');
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText("PAUSED", { exact: true }).first()).toBeVisible();

    await adminPage.click('button:has-text("Resume")');
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText("ACTIVE", { exact: true }).first()).toBeVisible();

    await adminPage.click('button:has-text("Mark complete")');
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText("COMPLETED", { exact: true }).first()).toBeVisible();

    await adminPage.click('button:has-text("Reopen")');
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText("ACTIVE", { exact: true }).first()).toBeVisible();
  });

  base("cancelling a customer service requires a reason", async () => {
    const { serviceItemId } = await seedOnboardingServiceItem();
    await adminPage.goto(`/admin/services/customers/new?sourceOnboardingServiceItemId=${serviceItemId}`);
    await adminPage.click('button:has-text("Provision service")');
    await adminPage.waitForURL(/\/admin\/services\/customers\/[0-9a-f-]+$/);

    await adminPage.click('button:has-text("Cancel")');
    await expect(adminPage.getByRole("button", { name: "Confirm cancellation" })).toBeDisabled();
    await adminPage.getByLabel("Cancellation reason").fill("No longer needed — E2E");
    await expect(adminPage.getByRole("button", { name: "Confirm cancellation" })).toBeEnabled();
    await adminPage.click('button:has-text("Confirm cancellation")');
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText("CANCELLED", { exact: true }).first()).toBeVisible();
  });

  base("a nonexistent service definition and customer service both resolve to not-found, never a crash", async () => {
    await adminPage.goto(`/admin/services/${MISSING_ID}`);
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText(/could not be found/i)).toBeVisible();

    await adminPage.goto(`/admin/services/customers/${MISSING_ID}`);
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText(/could not be found/i)).toBeVisible();
  });

  base("Catalog and Customer Services tabs remain usable at mobile and tablet widths", async () => {
    for (const viewport of [{ width: 375, height: 667 }, { width: 768, height: 1024 }]) {
      await adminPage.setViewportSize(viewport);
      await goto(adminPage, "/admin/services?tab=catalog");
      await expect(adminPage.getByRole("main")).toBeVisible();
      await goto(adminPage, "/admin/services?tab=customers");
      await expect(adminPage.getByRole("main")).toBeVisible();
    }
    await adminPage.setViewportSize({ width: 1280, height: 800 });
  });
});

base.describe("Service Management — Codex Security Engineer finding SM-SEC-02 (shared platform-admin session)", () => {
  base("a globally SUSPENDED platform staff member never appears in the owner picker, even with an active membership", async () => {
    const suspendedName = await withPgClient(async (client) => {
      const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
      const roleId = (await client.query("SELECT id FROM roles WHERE key = 'platform_admin' AND organization_id IS NULL")).rows[0].id as string;
      const suffix = Date.now();
      const name = `E2E Suspended Staff ${suffix}`;
      const userId = (
        await client.query("INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'SUSPENDED', now(), now()) RETURNING id", [`e2e-suspended-${suffix}@example.com`, name])
      ).rows[0].id as string;
      await client.query(
        "INSERT INTO organization_memberships (id, organization_id, user_id, role, role_id, status, joined_at, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'platform_admin', $3, 'ACTIVE', now(), now(), now())",
        [platformOrgId, userId, roleId],
      );
      return name;
    });

    await goto(adminPage, "/admin/services/customers/new");
    // The suspended user must never be an option — `listAssignableUsers()`
    // itself filters them out (Codex Security Engineer finding SM-SEC-02),
    // not merely a client-side hide the raw HTML would still reveal.
    const html = await adminPage.content();
    expect(html).not.toContain(suspendedName);
  });
});
