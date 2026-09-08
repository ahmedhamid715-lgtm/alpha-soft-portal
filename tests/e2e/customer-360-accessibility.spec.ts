import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Customer 360 accessibility coverage (Build 24 — Roadmap Module 18) —
 * direct style/helper template from
 * `client-onboarding-accessibility.spec.ts` (Build 23), INCLUDING its
 * own fix: one shared login for the whole file (`beforeAll`), not one
 * per test — see that file's own comment for the real
 * `authRateLimiter` exhaustion this avoids. Written directly by Claude,
 * same reasoning as `customer-360.spec.ts`'s own top comment.
 */
let context: BrowserContext;
let page: Page;

base.beforeAll(async ({ browser, baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);

  context = await browser.newContext();
  page = await context.newPage();
  await loginAs(page, "platform-admin@alpha-os.test");
});

base.afterAll(async () => {
  await context?.close();
});

const PASSWORD = "alpha-os-dev-password";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://ahmed@localhost:5432/alpha_os_dev";
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
} as const;
const TABS = ["Overview", "Contacts", "Services", "Sales", "Onboarding", "Billing", "Activity", "Documents", "Projects / Support / Conversations"] as const;

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

/** A company with real data across every tab, seeded once for the whole file — mirrors `customer-360.spec.ts`'s own `seedFullCustomerScenario()` exactly (kept local/duplicated rather than shared, matching this test suite's own established "each E2E file is self-contained" convention). */
async function seedFullCustomerScenario(): Promise<string> {
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const suffix = Date.now();
    const companyName = `A11y Customer 360 ${suffix}`;

    const companyId = (await client.query("INSERT INTO crm_companies (id, organization_id, name, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now()) RETURNING id", [platformOrgId, companyName])).rows[0].id as string;
    const pipelineId = (await client.query("SELECT id FROM crm_pipelines WHERE organization_id = $1 AND is_default = true", [platformOrgId])).rows[0].id as string;
    const wonStageId = (await client.query("SELECT id FROM crm_pipeline_stages WHERE pipeline_id = $1 AND is_won = true", [pipelineId])).rows[0].id as string;
    const dealId = (
      await client.query(
        "INSERT INTO crm_deals (id, organization_id, pipeline_id, stage_id, company_id, title, value_minor_units, currency, status, won_at, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 250000, 'USD', 'WON', now(), $6, now(), now()) RETURNING id",
        [platformOrgId, pipelineId, wonStageId, companyId, `${companyName} — deal`, adminUserId],
      )
    ).rows[0].id as string;
    const proposalId = (
      await client.query("INSERT INTO crm_proposals (id, organization_id, deal_id, company_id, proposal_number, status, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACCEPTED', $5, now(), now()) RETURNING id", [
        platformOrgId,
        dealId,
        companyId,
        `A11Y-360-${suffix}`,
        adminUserId,
      ])
    ).rows[0].id as string;
    const versionId = (
      await client.query(
        "INSERT INTO crm_proposal_versions (id, organization_id, proposal_id, version_number, status, title, body_html, currency, subtotal_minor_units, discount_type, discounted_subtotal_minor_units, total_minor_units, valid_until, accepted_at, accepted_signer_name, accepted_signer_email, accepted_by_staff_user_id, acceptance_mechanism, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 1, 'ACCEPTED', 'A11y 360 Proposal', '<p>Body</p>', 'USD', 250000, 'NONE', 250000, 250000, now() + interval '30 days', now(), 'A11y Signer', 'signer@example.com', $3, 'INTERNAL_RECORDED', $3, now(), now()) RETURNING id",
        [platformOrgId, proposalId, adminUserId],
      )
    ).rows[0].id as string;
    await client.query("UPDATE crm_proposals SET current_version_id = $1 WHERE id = $2", [versionId, proposalId]);
    await client.query(
      "INSERT INTO crm_proposal_line_items (id, organization_id, version_id, title, quantity, unit_amount_minor_units, discount_type, line_total_minor_units, sort_order, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'SEO retainer', 1, 250000, 'NONE', 250000, 0, now(), now())",
      [platformOrgId, versionId],
    );
    const contractId = (
      await client.query(
        "INSERT INTO crm_contracts (id, organization_id, deal_id, company_id, originating_proposal_id, originating_proposal_version_id, contract_number, status, effective_date, activated_at, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'ACTIVE', now(), now(), $7, now(), now()) RETURNING id",
        [platformOrgId, dealId, companyId, proposalId, versionId, `A11Y-360-CTR-${suffix}`, adminUserId],
      )
    ).rows[0].id as string;
    const linkedOrgId = (
      await client.query("INSERT INTO organizations (id, name, display_name, slug, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $1, $2, 'ACTIVE', now(), now()) RETURNING id", [companyName, `a11y-360-linked-${suffix}`])
    ).rows[0].id as string;
    await client.query("UPDATE crm_companies SET converted_to_organization_id = $1 WHERE id = $2", [linkedOrgId, companyId]);
    const onboardingId = (
      await client.query(
        "INSERT INTO crm_client_onboardings (id, organization_id, deal_id, company_id, linked_organization_id, originating_contract_id, originating_proposal_id, status, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'IN_PROGRESS', $7, now(), now()) RETURNING id",
        [platformOrgId, dealId, companyId, linkedOrgId, contractId, proposalId, adminUserId],
      )
    ).rows[0].id as string;
    await client.query(
      "INSERT INTO crm_client_onboarding_service_items (id, organization_id, onboarding_id, title, quantity, onboarding_required, sort_order, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'SEO retainer', 1, true, 0, now(), now())",
      [platformOrgId, onboardingId],
    );
    await client.query("INSERT INTO billing_accounts (id, organization_id, status, currency, provider, provider_customer_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, 'ACTIVE', 'USD', 'STRIPE', $2, now(), now())", [
      linkedOrgId,
      `cus_a11y_360_${suffix}`,
    ]);

    return companyId;
  });
}

base.describe("Customer 360 accessibility (Module 18)", () => {
  base("every tab has no axe violations on desktop, in both themes", async () => {
    const companyId = await seedFullCustomerScenario();
    await page.setViewportSize(VIEWPORTS.desktop);

    for (const scheme of ["light", "dark"] as const) {
      await setColorScheme(page, scheme);
      await goto(page, `/admin/crm/customers/${companyId}`);
      await expect(page.getByRole("main")).toBeVisible();
      for (const tabName of TABS) {
        await page.getByRole("tab", { name: tabName }).click();
        await scan(page);
      }
    }
  });

  for (const scheme of ["light", "dark"] as const) {
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      base(`the prospect (empty-state-heavy) view has no axe violations (${scheme}, ${viewportName})`, async () => {
        await page.setViewportSize(viewport);
        await setColorScheme(page, scheme);
        // A fresh prospect company — every future-domain section renders
        // its EmptyState, the exact "dense empty/future states" case the
        // Build 24 authorization calls out for accessibility coverage.
        const companyId = await withPgClient(async (client) => {
          const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
          return (await client.query("INSERT INTO crm_companies (id, organization_id, name, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now()) RETURNING id", [platformOrgId, `A11y Prospect ${Date.now()}`])).rows[0]
            .id as string;
        });
        await goto(page, `/admin/crm/customers/${companyId}`);
        await scan(page);
      });
    }
  }
});
