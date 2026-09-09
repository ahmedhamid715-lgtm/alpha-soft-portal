import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Customer Portal accessibility coverage (Build 26 — Roadmap Module 20)
 * — external customers use this surface directly, so it gets the same
 * "especially clean" bar every prior build's own accessibility spec
 * already established, applied here to a much larger page set. Two
 * shared logins for the whole file (`beforeAll`, one per role) — the
 * same `authRateLimiter`-exhaustion fix Build 23 established, extended
 * to two roles since the billing/company-edit DOM genuinely differs
 * between `owner-a` (full access — `billing.read`, `organizations.update`,
 * `members.read`) and `viewer-a` (read-only — none of those three).
 */
let ownerContext: BrowserContext;
let ownerPage: Page;
let viewerContext: BrowserContext;
let viewerPage: Page;

base.beforeAll(async ({ browser, baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);

  ownerContext = await browser.newContext();
  ownerPage = await ownerContext.newPage();
  await loginAs(ownerPage, "owner-a@alpha-os.test");

  viewerContext = await browser.newContext();
  viewerPage = await viewerContext.newPage();
  await loginAs(viewerPage, "viewer-a@alpha-os.test");
});

base.afterAll(async () => {
  await ownerContext?.close();
  await viewerContext?.close();
});

const PASSWORD = "alpha-os-dev-password";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://ahmed@localhost:5432/alpha_os_dev";
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, tablet: { width: 768, height: 1024 }, mobile: { width: 375, height: 667 } } as const;

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

/** See prior builds' identical comment — a scan right after a state change can catch the shared `Button`'s own `transition-all`/`disabled:opacity-50` mid-transition. */
async function settleAnimations(page: Page): Promise<void> {
  await page.waitForTimeout(250);
}

async function scan(page: Page) {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function seedPortalEngagement(organizationId: string): Promise<void> {
  await withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const suffix = Date.now();

    // Idempotent "find or create" — see `portal.spec.ts`'s own identical
    // comment: `crm_companies.converted_to_organization_id` is UNIQUE,
    // so a rerun against the same organization reuses the existing
    // converted company rather than colliding on a second insert.
    const existing = await client.query("SELECT id, name FROM crm_companies WHERE converted_to_organization_id = $1", [organizationId]);
    const companyName = existing.rows[0]?.name ?? `A11y Portal Co ${suffix}`;
    const companyId = (
      existing.rows[0]
        ? existing
        : await client.query("INSERT INTO crm_companies (id, organization_id, name, status, converted_to_organization_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', $3, now(), now()) RETURNING id", [
            platformOrgId,
            companyName,
            organizationId,
          ])
    ).rows[0].id as string;
    const pipelineId = (await client.query("INSERT INTO crm_pipelines (id, organization_id, name, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, now(), now()) RETURNING id", [platformOrgId, `A11y Portal Pipeline ${suffix}`])).rows[0]
      .id as string;
    const wonStageId = (
      await client.query("INSERT INTO crm_pipeline_stages (id, organization_id, pipeline_id, name, sort_order, is_won, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'Won', 1000, true, now(), now()) RETURNING id", [
        platformOrgId,
        pipelineId,
      ])
    ).rows[0].id as string;
    const dealId = (
      await client.query(
        "INSERT INTO crm_deals (id, organization_id, pipeline_id, stage_id, company_id, title, value_minor_units, currency, status, won_at, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 400000, 'USD', 'WON', now(), $6, now(), now()) RETURNING id",
        [platformOrgId, pipelineId, wonStageId, companyId, `${companyName} — deal`, adminUserId],
      )
    ).rows[0].id as string;
    const contractId = (
      await client.query(
        "INSERT INTO crm_contracts (id, organization_id, deal_id, company_id, contract_number, status, effective_date, end_date, activated_at, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACTIVE', now(), now() + interval '180 days', now(), $5, now(), now()) RETURNING id",
        [platformOrgId, dealId, companyId, `A11Y-PORTAL-CTR-${suffix}`, adminUserId],
      )
    ).rows[0].id as string;
    const onboardingId = (
      await client.query(
        "INSERT INTO crm_client_onboardings (id, organization_id, deal_id, company_id, linked_organization_id, originating_contract_id, status, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'IN_PROGRESS', $6, now(), now()) RETURNING id",
        [platformOrgId, dealId, companyId, organizationId, contractId, adminUserId],
      )
    ).rows[0].id as string;
    await client.query(
      "INSERT INTO crm_client_onboarding_service_items (id, organization_id, onboarding_id, title, quantity, onboarding_required, sort_order, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 1, true, 0, now(), now())",
      [platformOrgId, onboardingId, `A11y Portal Service ${suffix}`],
    );
    const proposalId = (
      await client.query(
        "INSERT INTO crm_proposals (id, organization_id, deal_id, company_id, proposal_number, status, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACCEPTED', $5, now(), now()) RETURNING id",
        [platformOrgId, dealId, companyId, `A11Y-PORTAL-PROP-${suffix}`, adminUserId],
      )
    ).rows[0].id as string;
    const versionId = (
      await client.query(
        "INSERT INTO crm_proposal_versions (id, organization_id, proposal_id, version_number, status, title, body_html, currency, subtotal_minor_units, discount_type, discounted_subtotal_minor_units, total_minor_units, valid_until, accepted_at, acceptance_mechanism, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 1, 'ACCEPTED', $3, '<p>A11y portal proposal body</p>', 'USD', 400000, 'NONE', 400000, 400000, now() + interval '30 days', now(), 'INTERNAL_RECORDED', $4, now(), now()) RETURNING id",
        [platformOrgId, proposalId, `A11y Portal Proposal ${suffix}`, adminUserId],
      )
    ).rows[0].id as string;
    await client.query("UPDATE crm_proposals SET current_version_id = $1 WHERE id = $2", [versionId, proposalId]);
    await client.query(
      "INSERT INTO crm_proposal_line_items (id, organization_id, version_id, title, quantity, unit_amount_minor_units, discount_type, line_total_minor_units, sort_order, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 1, 400000, 'NONE', 400000, 0, now(), now())",
      [platformOrgId, versionId, `A11y Portal Line Item ${suffix}`],
    );
  });
}

async function orgIdBySlug(slug: string): Promise<string> {
  return withPgClient((client) => client.query("SELECT id FROM organizations WHERE slug = $1", [slug]).then((r) => r.rows[0].id as string));
}

const READ_PAGES = ["/portal", "/portal/company", "/portal/services", "/portal/documents", "/portal/billing", "/portal/notifications", "/portal/assistant", "/portal/profile", "/portal/projects", "/portal/tasks", "/portal/reports", "/portal/tickets", "/portal/messages"];

base.describe("Customer Portal accessibility (Module 20)", () => {
  base("every core Portal page (owner — full access), desktop, light + dark: zero axe violations", async () => {
    const orgId = await orgIdBySlug("acme-corp-dev");
    await seedPortalEngagement(orgId);
    await ownerPage.setViewportSize(VIEWPORTS.desktop);

    for (const scheme of ["light", "dark"] as const) {
      await setColorScheme(ownerPage, scheme);
      for (const path of READ_PAGES) {
        await goto(ownerPage, path);
        await scan(ownerPage);
      }
    }
  });

  base("billing invoices + invoice detail (owner): zero axe violations", async () => {
    await ownerPage.setViewportSize(VIEWPORTS.desktop);
    await goto(ownerPage, "/portal/billing/invoices");
    await scan(ownerPage);
    const firstInvoiceLink = ownerPage.locator("table a[href*='/portal/billing/invoices/']").first();
    if (await firstInvoiceLink.count()) {
      await firstInvoiceLink.click();
      await expectNoApplicationError(ownerPage);
      await scan(ownerPage);
    }
  });

  base("My Company edit form (owner): zero axe violations", async () => {
    await ownerPage.setViewportSize(VIEWPORTS.desktop);
    await goto(ownerPage, "/portal/company");
    await expect(ownerPage.getByLabel("Company name")).toBeVisible();
    await scan(ownerPage);
  });

  base("every core Portal page (viewer — read-only), desktop: zero axe violations", async () => {
    await viewerPage.setViewportSize(VIEWPORTS.desktop);
    for (const path of READ_PAGES) {
      await goto(viewerPage, path);
      await scan(viewerPage);
    }
  });

  base("the Portal dashboard remains usable and violation-free at mobile and tablet widths", async () => {
    for (const viewport of [VIEWPORTS.mobile, VIEWPORTS.tablet]) {
      await ownerPage.setViewportSize(viewport);
      await goto(ownerPage, "/portal");
      await scan(ownerPage);
    }
    await ownerPage.setViewportSize(VIEWPORTS.desktop);
  });

  base("a bare organization with no CRM engagement (every empty state at once): zero axe violations", async () => {
    await ownerPage.setViewportSize(VIEWPORTS.desktop);
    // owner-b/Beta Industries has no CRM link seeded by this file — a
    // genuinely different account is needed since owner-a's own org now
    // has a real engagement from the test above. Login is cheap here
    // (one extra call, not a loop) and stays within the rate limiter.
    await loginAs(ownerPage, "owner-b@alpha-os.test");
    for (const path of ["/portal", "/portal/company", "/portal/services", "/portal/documents"]) {
      await goto(ownerPage, path);
      await scan(ownerPage);
    }
    await loginAs(ownerPage, "owner-a@alpha-os.test");
  });
});
