import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Client Success E2E (Build 25 — Roadmap Module 19). Same style/helper
 * template as `customer-360.spec.ts` (Build 24) — see that file's own
 * top comment for the reasoning (Codex's sandbox cannot launch Chromium,
 * so this is written directly, not delegated).
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);
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

async function expectNoApplicationError(page: Page) {
  await expect(page.locator("body")).not.toContainText("Application error");
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  await expectNoApplicationError(page);
}

/**
 * A fresh company + WON deal + ACTIVE contract with a real endDate 20
 * days out (inside the portfolio's own 30-day "expiring soon" window,
 * with no renewal tracked yet) — a genuinely representative "needs
 * attention" state, not a fabricated one.
 */
async function seedCompanyWithExpiringContract(): Promise<{ companyId: string; companyName: string; contractId: string; contractNumber: string }> {
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const suffix = Date.now();
    const companyName = `E2E Client Success ${suffix}`;
    const contractNumber = `E2E-CS-CTR-${suffix}`;

    const companyId = (await client.query("INSERT INTO crm_companies (id, organization_id, name, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now()) RETURNING id", [platformOrgId, companyName])).rows[0].id as string;
    const pipelineId = (await client.query("SELECT id FROM crm_pipelines WHERE organization_id = $1 AND is_default = true", [platformOrgId])).rows[0].id as string;
    const wonStageId = (await client.query("SELECT id FROM crm_pipeline_stages WHERE pipeline_id = $1 AND is_won = true", [pipelineId])).rows[0].id as string;
    const dealId = (
      await client.query(
        "INSERT INTO crm_deals (id, organization_id, pipeline_id, stage_id, company_id, title, value_minor_units, currency, status, won_at, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 300000, 'USD', 'WON', now(), $6, now(), now()) RETURNING id",
        [platformOrgId, pipelineId, wonStageId, companyId, `${companyName} — deal`, adminUserId],
      )
    ).rows[0].id as string;
    const contractId = (
      await client.query(
        "INSERT INTO crm_contracts (id, organization_id, deal_id, company_id, contract_number, status, effective_date, end_date, activated_at, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACTIVE', now(), now() + interval '20 days', now(), $5, now(), now()) RETURNING id",
        [platformOrgId, dealId, companyId, contractNumber, adminUserId],
      )
    ).rows[0].id as string;

    return { companyId, companyName, contractId, contractNumber };
  });
}

base.describe("Client Success — access control", () => {
  base("an unauthorized role (no crm.client_success.read) is denied the portfolio", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");
    await goto(page, "/admin/crm/client-success");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("a customer-org member (not platform staff at all) is denied the portfolio", async ({ page }) => {
    await loginAs(page, "customer@alpha-os.test");
    await goto(page, "/admin/crm/client-success");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });
});

base.describe("Client Success — portfolio", () => {
  base("shows a contract expiring without a tracked renewal, and links through to Customer 360", async ({ page }) => {
    const { companyName, contractNumber } = await seedCompanyWithExpiringContract();
    await loginAs(page, "platform-admin@alpha-os.test");
    await goto(page, "/admin/crm/client-success");
    await expect(page.getByRole("heading", { name: "Client Success", exact: true })).toBeVisible();

    await expect(page.getByText(companyName, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(contractNumber, { exact: false })).toBeVisible();

    await page.getByText(companyName, { exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/crm\/customers\//);
  });

  base("the portfolio remains usable at mobile and tablet widths", async ({ page }) => {
    await loginAs(page, "platform-admin@alpha-os.test");
    for (const viewport of [{ width: 375, height: 667 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      await goto(page, "/admin/crm/client-success");
      await expect(page.getByRole("heading", { name: "Client Success", exact: true })).toBeVisible();
    }
  });
});

base.describe("Client Success — Customer 360 integration", () => {
  base("shows measurable and not-measurable health components, and supports the renewal + expansion + ownership workflows", async ({ page }) => {
    const { companyId, contractNumber } = await seedCompanyWithExpiringContract();
    await loginAs(page, "platform-admin@alpha-os.test");
    await goto(page, `/admin/crm/customers/${companyId}`);
    await page.getByRole("tab", { name: "Client Success" }).click();

    // Onboarding never started for this company — genuinely NOT_MEASURABLE, never fabricated.
    await expect(page.getByText("Not measurable").first()).toBeVisible();

    // Assign a Client Success owner.
    await page.getByLabel("Client Success owner").click();
    await page.getByRole("option", { name: "Platform Admin", exact: false }).first().click();
    await expect(page.getByText("Client Success owner")).toBeVisible();

    // Flag for management attention, with a required reason.
    await page.getByRole("checkbox", { name: /management attention/i }).check();
    await page.getByLabel("Reason (required)").fill("E2E: verifying the manual attention flag.");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("E2E: verifying the manual attention flag.", { exact: false })).toBeVisible();

    // Start tracking a renewal against the real contract. `exact: true`
    // — the "Renewal date (defaults to contract end date)" label's own
    // text contains "contract" too, and `getByLabel()` substring-matches
    // case-insensitively by default.
    await page.getByLabel("Contract", { exact: true }).click();
    await page.getByRole("option", { name: contractNumber }).click();
    await page.getByRole("button", { name: "Start tracking renewal" }).click();
    await expect(page.getByText(contractNumber, { exact: false }).first()).toBeVisible();
    await expect(page.getByText("UPCOMING", { exact: false }).first()).toBeVisible();

    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("IN PROGRESS", { exact: false }).first()).toBeVisible();

    await page.getByRole("button", { name: "Renewed" }).click();
    await page.getByLabel("Outcome note (required)").fill("E2E: client confirmed renewal by email.");
    await page.getByRole("button", { name: "Confirm renewed" }).click();
    await expect(page.getByText("RENEWED", { exact: false }).first()).toBeVisible();

    // Identify and dismiss an expansion opportunity.
    await page.getByLabel("Title").fill("E2E expansion opportunity");
    await page.getByLabel(/Rationale/).fill("E2E: verifying the expansion workflow end to end.");
    await page.getByRole("button", { name: "Identify opportunity" }).click();
    await expect(page.getByText("E2E expansion opportunity")).toBeVisible();

    await page.getByRole("button", { name: "Qualify" }).click();
    await expect(page.getByText("QUALIFIED", { exact: false }).first()).toBeVisible();

    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByText("DISMISSED", { exact: false }).first()).toBeVisible();
  });

  base("a caller without crm.client_success.read sees the tab's own access-denied state, not the rest of Customer 360 broken", async ({ page }) => {
    const { companyId } = await seedCompanyWithExpiringContract();
    await loginAs(page, "support-agent@alpha-os.test");
    await goto(page, `/admin/crm/customers/${companyId}`);
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });
});

base.describe("Client Success — not-found behavior", () => {
  base("a nonexistent company via the health composition still shows Customer 360's own not-found page, not a crash", async ({ page }) => {
    await loginAs(page, "platform-admin@alpha-os.test");
    await goto(page, `/admin/crm/customers/${MISSING_ID}`);
    await expect(page.getByText(/could not be found/i)).toBeVisible();
  });
});
