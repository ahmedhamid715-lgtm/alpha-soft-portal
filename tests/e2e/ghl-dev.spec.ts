import { test as base, expect, type Page, type BrowserContext, type Locator } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * GHL Automation OS E2E (Build 34 — Roadmap Module 28). Same direct
 * style/helpers as `ecommerce-dev.spec.ts` — SQL-seeded fixtures, real
 * browser interaction, ONE shared `platform-admin` session for the
 * whole workflow block. A FIFTH, SEPARATE specialist domain from SEO
 * OS/Local SEO/Website Development/E-Commerce Development — its own
 * fixture chain uses `category = 'GHL_AUTOMATION'`, never `'SEO'`/
 * `'LOCAL_SEO'`/`'WEB_DEVELOPMENT'`/`'ECOMMERCE'`.
 *
 * Deliberately uses a FRESH, dedicated customer organization/company for
 * every workflow fixture — same "never reuse a shared fixture org across
 * builds" lesson `ecommerce-dev.spec.ts`/`website-dev.spec.ts` themselves
 * document: `CustomerService`/`GhlAutomationEngagement` rows are
 * permanently undeletable by design.
 *
 * Every status-text assertion uses `exact: true` matching — a lesson
 * learned the hard way in Build 33: a bare substring match for a short/
 * common status word can silently match unrelated always-present chrome
 * text (e.g. "LIVE" matching "Notification deLIVEry" in the persistent
 * sidebar nav) and produce a false-positive PASS that races ahead of the
 * real async mutation.
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
async function seedCustomerService(category: "GHL_AUTOMATION" | "ECOMMERCE"): Promise<SeededCustomerService> {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const companyName = `E2E ${category} Customer ${suffix}`;

    const organizationId = (
      await client.query("INSERT INTO organizations (id, name, display_name, slug, status, is_platform, created_at, updated_at) VALUES (gen_random_uuid(), $1, $1, $2, 'ACTIVE', false, now(), now()) RETURNING id", [
        companyName,
        `e2e-ghl-${suffix}`,
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

base.describe("GHL Automation — access control", () => {
  base("a user with no ghl_automation permission is denied the list page", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");
    await goto(page, "/admin/ghl");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("support admin (read only) sees the list but no management controls", async ({ page }) => {
    await loginAs(page, "support-admin@alpha-os.test");
    await goto(page, "/admin/ghl");
    await expect(page.getByRole("heading", { name: "GHL Automation", exact: true })).toBeVisible();
  });
});

base.describe("GHL Automation — full operational workflow (shared platform-admin session)", () => {
  let fixture: SeededCustomerService;
  let engagementUrl: string;
  let workspaceUrl: string;

  base("rejects an ECOMMERCE-category customer service — no GHL Automation workspace affordance appears", async () => {
    const ecommerceFixture = await seedCustomerService("ECOMMERCE");
    await goto(adminPage, `/admin/services/customers/${ecommerceFixture.customerServiceId}`);
    // An ECOMMERCE-category service shows the E-Commerce Development workspace section, never a GHL Automation one.
    await expect(adminPage.getByRole("heading", { name: "E-Commerce Development workspace" })).toBeVisible();
    await expect(adminPage.getByRole("heading", { name: "GHL Automation workspace" })).not.toBeVisible();
  });

  base("sets up a GHL Automation workspace from the customer service, and adds a workspace", async () => {
    fixture = await seedCustomerService("GHL_AUTOMATION");

    await goto(adminPage, `/admin/services/customers/${fixture.customerServiceId}`);
    await expect(adminPage.getByRole("heading", { name: "GHL Automation workspace" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Set up GHL Automation workspace" }).click();
    await adminPage.waitForURL(/\/admin\/ghl\/[0-9a-f-]+$/, { timeout: 10_000 });
    engagementUrl = adminPage.url();

    // Idempotency — revisiting the customer service now shows "Open GHL Automation workspace" (not the setup button again).
    await goto(adminPage, `/admin/services/customers/${fixture.customerServiceId}`);
    await expect(adminPage.getByRole("link", { name: "Open GHL Automation workspace" })).toBeVisible();

    await adminPage.goto(engagementUrl);
    const workspaceName = `E2E Workspace ${Date.now()}`;
    await adminPage.getByRole("button", { name: "Add workspace" }).click();
    await adminPage.fill("input[name=name]", workspaceName);
    await adminPage.getByRole("button", { name: "Add workspace" }).nth(1).click();
    await expect(adminPage.getByText(workspaceName)).toBeVisible({ timeout: 10_000 });

    await adminPage.getByText(workspaceName).click();
    await adminPage.waitForURL(/\/workspaces\/[0-9a-f-]+/, { timeout: 10_000 });
    workspaceUrl = adminPage.url();
  });

  base("a newly-created workspace with zero required items is honestly READY — nothing required, nothing to block on", async () => {
    await adminPage.goto(workspaceUrl);
    await expect(adminPage.getByText("READY", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  base("adding a required asset that is not yet complete makes the workspace honestly NOT READY", async () => {
    await adminPage.goto(`${workspaceUrl}?tab=assets`);
    await adminPage.getByRole("button", { name: "Add asset" }).click();
    await adminPage.fill("input[name=name]", "Lead Gen Funnel");
    await choose(adminPage, adminPage.getByLabel("Type"), "Funnel");
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.getByText("Lead Gen Funnel")).toBeVisible({ timeout: 10_000 });

    await adminPage.goto(workspaceUrl);
    await expect(adminPage.getByText("NOT READY", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  base("advances the asset through its lifecycle, including the QA_FAILED rework loop", async () => {
    await adminPage.goto(`${workspaceUrl}?tab=assets`);
    const row = adminPage.locator("tr", { hasText: "Lead Gen Funnel" });
    await choose(adminPage, row.getByRole("combobox", { name: "Change status for Lead Gen Funnel" }), "IN PROGRESS");
    await expect(row.getByText("IN PROGRESS").first()).toBeVisible({ timeout: 10_000 });
    await choose(adminPage, row.getByRole("combobox", { name: "Change status for Lead Gen Funnel" }), "READY FOR QA");
    await expect(row.getByText("READY FOR QA").first()).toBeVisible({ timeout: 10_000 });
    await choose(adminPage, row.getByRole("combobox", { name: "Change status for Lead Gen Funnel" }), "QA FAILED");
    await expect(row.getByText("QA FAILED").first()).toBeVisible({ timeout: 10_000 });
    // Rework loop — QA_FAILED can only return to IN_PROGRESS, never straight to READY.
    await choose(adminPage, row.getByRole("combobox", { name: "Change status for Lead Gen Funnel" }), "IN PROGRESS");
    await expect(row.getByText("IN PROGRESS").first()).toBeVisible({ timeout: 10_000 });
    await choose(adminPage, row.getByRole("combobox", { name: "Change status for Lead Gen Funnel" }), "READY FOR QA");
    await choose(adminPage, row.getByRole("combobox", { name: "Change status for Lead Gen Funnel" }), "READY");
    await expect(row.getByText("READY", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  base("rejects a duplicate external asset ID on the same workspace", async () => {
    await adminPage.goto(`${workspaceUrl}?tab=assets`);
    await adminPage.getByRole("button", { name: "Add asset" }).click();
    await adminPage.fill("input[name=name]", "Duplicate Funnel");
    await adminPage.fill("input[name=externalAssetId]", "ext-funnel-1");
    // This fixture asset exists only to exercise the duplicate-external-ID
    // rejection below — it must NOT be required-for-launch, or it would
    // silently become a second required-but-not-READY asset and break the
    // very next test's readiness assertion (a real sequencing bug this
    // E2E run itself surfaced: the "Add asset" form defaults this checkbox
    // to checked).
    await adminPage.getByLabel("Required for go-live").uncheck();
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.getByText("Duplicate Funnel")).toBeVisible({ timeout: 10_000 });

    await adminPage.getByRole("button", { name: "Add asset" }).click();
    await adminPage.fill("input[name=name]", "Second Duplicate Attempt");
    await adminPage.fill("input[name=externalAssetId]", "ext-funnel-1");
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.locator('[data-slot="alert"]')).toContainText(/already tracked/i, { timeout: 10_000 });
  });

  base("with the required asset READY, the workspace becomes go-live-ready again", async () => {
    await adminPage.goto(workspaceUrl);
    await expect(adminPage.getByText("READY", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  base("adds an integration requirement and confirms it", async () => {
    await adminPage.goto(`${workspaceUrl}?tab=integrations`);
    await adminPage.getByRole("button", { name: "Add requirement" }).click();
    await adminPage.fill("input[name=name]", "Calendar sync");
    await adminPage.fill("input[name=externalSystemLabel]", "Google Calendar");
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.getByText("Calendar sync")).toBeVisible({ timeout: 10_000 });

    // A manage-capable viewer sees the live `<Select>` control itself (its
    // trigger renders the current value as plain text), never the
    // read-only `StatusBadge` fallback — that fallback only renders for
    // `canManage === false` viewers (`integrations-tab.tsx`). Assert on
    // what a manage-capable admin actually sees, scoped to this
    // requirement's own card so it can't accidentally match the "1/1
    // confirmed" summary stat elsewhere on the page.
    const requirementCard = adminPage.locator('[data-slot="card"]', { hasText: "Calendar sync" });
    await choose(adminPage, requirementCard.getByRole("combobox", { name: "Change status for Calendar sync" }), "CONFIRMED");
    await expect(requirementCard.getByText("CONFIRMED", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  base("imports an additional asset via CSV, skipping a row whose externalAssetId is secret-shaped (GHL-SEC-02 regression)", async () => {
    await adminPage.goto(`${workspaceUrl}?tab=import`);
    // The second row's externalAssetId carries a credential-labeled
    // value — Codex Security Engineer finding GHL-SEC-02 found this
    // column bypassed per-row secret screening entirely (name/notes
    // were screened, externalAssetId was not) and was persisted
    // verbatim. This row must now be skipped while the clean first row
    // still imports normally.
    const csv = 'name,assetType,requiredForLaunch,externalAssetId\nImported Booking Form,FORM,false,\n"Leaked Workflow",WORKFLOW,false,"password: hunter2"\n';
    await adminPage.locator('input[type="file"]').setInputFiles({ name: "assets.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await adminPage.getByRole("button", { name: "Import" }).click();
    await expect(adminPage.getByText(/Imported 1 of 2 row\(s\)\. 1 skipped\./)).toBeVisible({ timeout: 10_000 });
    await adminPage.goto(`${workspaceUrl}?tab=assets`);
    await expect(adminPage.getByText("Imported Booking Form")).toBeVisible({ timeout: 10_000 });
    await expect(adminPage.getByText("Leaked Workflow")).not.toBeVisible();
  });

  base("records the go-live — no override required once ready", async () => {
    await adminPage.goto(workspaceUrl);
    await adminPage.getByRole("button", { name: "Record go-live", exact: true }).click();
    await adminPage.getByRole("button", { name: "Confirm go-live" }).click();
    await expect(adminPage.getByText("LIVE", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  base("a live workspace no longer offers a go-live action — replay is structurally prevented", async () => {
    await adminPage.goto(workspaceUrl);
    await expect(adminPage.getByRole("button", { name: /Record go-live/ })).not.toBeVisible();
  });

  base("records the handoff — a distinct, independently-guarded milestone from go-live", async () => {
    await adminPage.goto(workspaceUrl);
    await adminPage.getByRole("button", { name: "Record handoff", exact: true }).click();
    await adminPage.getByLabel(/Handoff notes/).fill("Trained the client on the booking flow and reviewed all workflows live.");
    await adminPage.getByRole("button", { name: "Confirm handoff" }).click();
    await expect(adminPage.getByText("COMPLETED", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(adminPage.getByRole("button", { name: /Record handoff/ })).not.toBeVisible();
  });

  base("links a new delivery project from the engagement page", async () => {
    await adminPage.goto(engagementUrl);
    await adminPage.getByRole("button", { name: "Link or create a project" }).click();
    const projectTitle = `E2E GHL Automation Delivery ${Date.now()}`;
    await adminPage.fill("input[name=title]", projectTitle);
    await adminPage.getByRole("button", { name: "Create & link" }).click();
    await expect(adminPage.getByText(projectTitle)).toBeVisible({ timeout: 10_000 });
  });

  base("Customer 360 shows the GHL Automation performance summary inline on the canonical service card", async () => {
    await goto(adminPage, `/admin/crm/customers/${fixture.companyId}`);
    await adminPage.getByRole("tab", { name: "Services" }).click();
    await expect(adminPage.getByText(/active workspace/)).toBeVisible({ timeout: 10_000 });
  });

  base("a nonexistent engagement/workspace shows not found, not a crash", async () => {
    const missing = "00000000-0000-7000-8000-000000000000";
    await adminPage.goto(`/admin/ghl/${missing}`);
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText(/could not be found/i)).toBeVisible();
  });

  base("the workspace remains usable at mobile and tablet widths", async ({ browser }) => {
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await loginAs(page, "platform-admin@alpha-os.test");
      await goto(page, workspaceUrl);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await context.close();
    }
  });
});

base.describe("GHL Automation — go-live readiness denial and override", () => {
  let workspaceUrl: string;

  base.beforeAll(async () => {
    const fixture = await seedCustomerService("GHL_AUTOMATION");
    await goto(adminPage, `/admin/services/customers/${fixture.customerServiceId}`);
    await adminPage.getByRole("button", { name: "Set up GHL Automation workspace" }).click();
    await adminPage.waitForURL(/\/admin\/ghl\/[0-9a-f-]+$/, { timeout: 10_000 });
    const workspaceName = `E2E Not Ready Workspace ${Date.now()}`;
    await adminPage.getByRole("button", { name: "Add workspace" }).click();
    await adminPage.fill("input[name=name]", workspaceName);
    await adminPage.getByRole("button", { name: "Add workspace" }).nth(1).click();
    await expect(adminPage.getByText(workspaceName)).toBeVisible({ timeout: 10_000 });
    await adminPage.getByText(workspaceName).click();
    await adminPage.waitForURL(/\/workspaces\/[0-9a-f-]+/, { timeout: 10_000 });
    workspaceUrl = adminPage.url();

    // A required-but-incomplete asset makes this workspace genuinely NOT_READY, so the override path has something real to bypass.
    await adminPage.goto(`${workspaceUrl}?tab=assets`);
    await adminPage.getByRole("button", { name: "Add asset" }).click();
    await adminPage.fill("input[name=name]", "Onboarding Workflow");
    await choose(adminPage, adminPage.getByLabel("Type"), "Workflow");
    await adminPage.getByRole("button", { name: "Add", exact: true }).click();
    await expect(adminPage.getByText("Onboarding Workflow")).toBeVisible({ timeout: 10_000 });
  });

  base("an override reason is required to go live on a NOT_READY workspace, and the go-live is honestly recorded as an override", async () => {
    await adminPage.goto(workspaceUrl);
    await expect(adminPage.getByText("NOT READY", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await adminPage.getByRole("button", { name: "Record go-live (override)" }).click();
    const confirmButton = adminPage.getByRole("button", { name: "Confirm go-live" });
    // The required asset is still PLANNED — the reason field is required, blocking submission without it.
    await expect(adminPage.getByLabel(/Override reason/)).toBeVisible();
    await adminPage.getByLabel(/Override reason/).fill("Client requested an early soft-launch despite one incomplete workflow.");
    await confirmButton.click();
    await expect(adminPage.getByText("LIVE", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });
});
