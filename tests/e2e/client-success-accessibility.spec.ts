import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Client Success accessibility coverage (Build 25 — Roadmap Module 19) —
 * same style/helper template as `customer-360-accessibility.spec.ts`
 * (Build 24): one shared login PER ROLE for the whole file (`beforeAll`),
 * not one per test, to avoid the `authRateLimiter` exhaustion documented
 * in `client-onboarding-accessibility.spec.ts`. Two roles are needed
 * here (unlike Build 24's single admin) because the Client Success tab
 * has a genuinely different DOM for `canManage` (platform-admin, has
 * `crm.client_success.manage`) vs. read-only (support-admin, has only
 * `crm.client_success.read`) — each gets its own shared page/context,
 * logged in once. Written directly by Claude, same reasoning as
 * `client-success.spec.ts`'s own top comment (Codex's sandbox cannot
 * launch Chromium).
 */
let adminContext: BrowserContext;
let adminPage: Page;
let supportContext: BrowserContext;
let supportPage: Page;

base.beforeAll(async ({ browser, baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);

  adminContext = await browser.newContext();
  adminPage = await adminContext.newPage();
  await loginAs(adminPage, "platform-admin@alpha-os.test");

  supportContext = await browser.newContext();
  supportPage = await supportContext.newPage();
  await loginAs(supportPage, "support-admin@alpha-os.test");
});

base.afterAll(async () => {
  await adminContext?.close();
  await supportContext?.close();
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
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  await expectNoApplicationError(page);
}

async function setColorScheme(page: Page, scheme: "light" | "dark") {
  await page.evaluate((value) => window.localStorage.setItem("theme", value), scheme);
}

/** See `client-onboarding-accessibility.spec.ts`'s own identical comment — Tailwind's `transition-all` on the shared `Button` (`disabled:opacity-50`) can be caught mid-transition by a scan that fires right after a state change. */
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

/**
 * A company with a mix of measurable AND not-measurable health
 * components in one seed — real ACTIVE contract (payment measurable via
 * a billing account), real CrmActivity (engagement measurable), real
 * IN_PROGRESS onboarding (onboarding measurable) — while Project/
 * Support/Service stay genuinely NOT_MEASURABLE (no authoritative
 * domain exists for them, Build 25's own honest boundary). Also seeds
 * one open (UPCOMING) renewal and one IDENTIFIED expansion opportunity
 * so the interactive per-row controls (Start/Renewed/Not renewing,
 * Qualify/Hand to Sales/Dismiss) are present to scan.
 */
async function seedFullClientSuccessScenario(): Promise<{ companyId: string }> {
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const suffix = Date.now();
    const companyName = `A11y Client Success ${suffix}`;

    const companyId = (await client.query("INSERT INTO crm_companies (id, organization_id, name, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now()) RETURNING id", [platformOrgId, companyName])).rows[0].id as string;
    const pipelineId = (await client.query("SELECT id FROM crm_pipelines WHERE organization_id = $1 AND is_default = true", [platformOrgId])).rows[0].id as string;
    const wonStageId = (await client.query("SELECT id FROM crm_pipeline_stages WHERE pipeline_id = $1 AND is_won = true", [pipelineId])).rows[0].id as string;
    const dealId = (
      await client.query(
        "INSERT INTO crm_deals (id, organization_id, pipeline_id, stage_id, company_id, title, value_minor_units, currency, status, won_at, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 400000, 'USD', 'WON', now(), $6, now(), now()) RETURNING id",
        [platformOrgId, pipelineId, wonStageId, companyId, `${companyName} — deal`, adminUserId],
      )
    ).rows[0].id as string;
    // A second, OPEN deal — not captured by id, just needs to exist so
    // `dealsForHandoff` (queried fresh by the page itself) is non-empty
    // and the "Hand to Sales" deal-picker Select actually renders an
    // option to scan.
    await client.query(
      "INSERT INTO crm_deals (id, organization_id, pipeline_id, stage_id, company_id, title, value_minor_units, currency, status, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 150000, 'USD', 'OPEN', $6, now(), now())",
      [platformOrgId, pipelineId, wonStageId, companyId, `${companyName} — expansion deal`, adminUserId],
    );
    const contractId = (
      await client.query(
        "INSERT INTO crm_contracts (id, organization_id, deal_id, company_id, contract_number, status, effective_date, end_date, activated_at, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACTIVE', now(), now() + interval '45 days', now(), $5, now(), now()) RETURNING id",
        [platformOrgId, dealId, companyId, `A11Y-CS-CTR-${suffix}`, adminUserId],
      )
    ).rows[0].id as string;
    const linkedOrgId = (
      await client.query("INSERT INTO organizations (id, name, display_name, slug, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $1, $2, 'ACTIVE', now(), now()) RETURNING id", [companyName, `a11y-cs-linked-${suffix}`])
    ).rows[0].id as string;
    await client.query("UPDATE crm_companies SET converted_to_organization_id = $1 WHERE id = $2", [linkedOrgId, companyId]);
    await client.query(
      "INSERT INTO crm_client_onboardings (id, organization_id, deal_id, company_id, linked_organization_id, originating_contract_id, status, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'IN_PROGRESS', $6, now(), now())",
      [platformOrgId, dealId, companyId, linkedOrgId, contractId, adminUserId],
    );
    await client.query("INSERT INTO billing_accounts (id, organization_id, status, currency, provider, provider_customer_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, 'ACTIVE', 'USD', 'STRIPE', $2, now(), now())", [
      linkedOrgId,
      `cus_a11y_cs_${suffix}`,
    ]);
    await client.query("INSERT INTO crm_activities (id, organization_id, company_id, type, body, actor_user_id, occurred_at, created_at) VALUES (gen_random_uuid(), $1, $2, 'NOTE', 'A11y engagement note', $3, now(), now())", [
      platformOrgId,
      companyId,
      adminUserId,
    ]);

    await client.query(
      "INSERT INTO crm_client_success_renewals (id, organization_id, company_id, contract_id, renewal_date, status, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, now() + interval '45 days', 'UPCOMING', $4, now(), now())",
      [platformOrgId, companyId, contractId, adminUserId],
    );
    await client.query(
      "INSERT INTO crm_client_success_expansion_opportunities (id, organization_id, company_id, title, rationale, status, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'A11y expansion opportunity', 'Seeded for accessibility coverage of the open expansion row controls.', 'IDENTIFIED', $3, now(), now())",
      [platformOrgId, companyId, adminUserId],
    );

    return { companyId };
  });
}

/** A bare-minimum company — no contract, no billing, no onboarding, no activity, no CS data at all. Every health component is NOT_MEASURABLE, churn risk is UNKNOWN, ownership is Unassigned, and both lists render their `EmptyState`. Mirrors `customer-360-accessibility.spec.ts`'s own "empty-state-heavy" case. */
async function seedBareCompany(): Promise<string> {
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    return (await client.query("INSERT INTO crm_companies (id, organization_id, name, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now()) RETURNING id", [platformOrgId, `A11y CS Bare ${Date.now()}`])).rows[0]
      .id as string;
  });
}

base.describe("Client Success accessibility (Module 19)", () => {
  base("portfolio: zero axe violations, light + dark, desktop", async () => {
    await seedFullClientSuccessScenario();
    await adminPage.setViewportSize({ width: 1280, height: 800 });
    for (const scheme of ["light", "dark"] as const) {
      await setColorScheme(adminPage, scheme);
      await goto(adminPage, "/admin/crm/client-success");
      await expect(adminPage.getByRole("heading", { name: "Client Success", exact: true })).toBeVisible();
      await scan(adminPage);
    }
  });

  base("portfolio: zero axe violations at mobile and tablet widths", async () => {
    for (const viewport of [{ width: 375, height: 667 }, { width: 768, height: 1024 }]) {
      await adminPage.setViewportSize(viewport);
      await goto(adminPage, "/admin/crm/client-success");
      await expect(adminPage.getByRole("heading", { name: "Client Success", exact: true })).toBeVisible();
      await scan(adminPage);
    }
    await adminPage.setViewportSize({ width: 1280, height: 800 });
  });

  base("Customer 360 Client Success tab (canManage): mixed measurable/not-measurable health, renewals, expansions — zero axe violations, light + dark", async () => {
    const { companyId } = await seedFullClientSuccessScenario();
    await adminPage.setViewportSize({ width: 1280, height: 800 });

    for (const scheme of ["light", "dark"] as const) {
      await setColorScheme(adminPage, scheme);
      await goto(adminPage, `/admin/crm/customers/${companyId}`);
      await adminPage.getByRole("tab", { name: "Client Success" }).click();
      await expect(adminPage.getByText("Not measurable").first()).toBeVisible();
      await scan(adminPage);
    }
  });

  base("Customer 360 Client Success tab (canManage): interactive reveal states — zero axe violations", async () => {
    const { companyId } = await seedFullClientSuccessScenario();
    await adminPage.setViewportSize({ width: 1280, height: 800 });
    await setColorScheme(adminPage, "light");
    await goto(adminPage, `/admin/crm/customers/${companyId}`);
    await adminPage.getByRole("tab", { name: "Client Success" }).click();

    // The management-attention checkbox reveals a required-reason Textarea.
    await adminPage.getByRole("checkbox", { name: /management attention/i }).check();
    await expect(adminPage.getByLabel("Reason (required)")).toBeVisible();
    await scan(adminPage);
    await adminPage.getByRole("checkbox", { name: /management attention/i }).uncheck();

    // "Renewed" reveals the inline required-outcome Textarea.
    await adminPage.getByRole("button", { name: "Renewed" }).click();
    await expect(adminPage.getByLabel("Outcome note (required)")).toBeVisible();
    await scan(adminPage);
    await adminPage.getByRole("button", { name: "Cancel" }).click();

    // "Hand to Sales" reveals the deal-picker Select.
    await adminPage.getByRole("button", { name: "Hand to Sales" }).click();
    await expect(adminPage.getByText("Link to an existing deal (optional)")).toBeVisible();
    await scan(adminPage);
  });

  base("Customer 360 Client Success tab (read-only, no manage): zero axe violations, light + dark", async () => {
    const { companyId } = await seedFullClientSuccessScenario();
    await supportPage.setViewportSize({ width: 1280, height: 800 });

    for (const scheme of ["light", "dark"] as const) {
      await setColorScheme(supportPage, scheme);
      await goto(supportPage, `/admin/crm/customers/${companyId}`);
      await supportPage.getByRole("tab", { name: "Client Success" }).click();
      // Read-only: no Ownership & attention section, no create-renewal/create-expansion forms.
      await expect(supportPage.getByText("Ownership & attention")).not.toBeVisible();
      await scan(supportPage);
    }
  });

  base("Customer 360 Client Success tab: bare/empty state (no contract, no billing, no CS data) — zero axe violations, light + dark", async () => {
    const companyId = await seedBareCompany();
    await adminPage.setViewportSize({ width: 1280, height: 800 });

    for (const scheme of ["light", "dark"] as const) {
      await setColorScheme(adminPage, scheme);
      await goto(adminPage, `/admin/crm/customers/${companyId}`);
      await adminPage.getByRole("tab", { name: "Client Success" }).click();
      await expect(adminPage.getByText("No renewals tracked")).toBeVisible();
      await expect(adminPage.getByText("No expansion opportunities")).toBeVisible();
      await scan(adminPage);
    }
  });
});
