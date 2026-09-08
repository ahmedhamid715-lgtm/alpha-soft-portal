import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Customer 360 E2E (Build 24 — Roadmap Module 18). Same style/helper
 * template as `client-onboarding.spec.ts` (Build 23) — see that file's
 * own top comment for the reasoning (Codex's sandbox cannot launch
 * Chromium, so this is written directly, not delegated).
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

/** A bare `CrmCompany` with no deals/proposals/contracts/onboarding at all — state 1, "prospect." */
async function seedProspectCompany(): Promise<{ companyId: string; companyName: string }> {
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const companyName = `E2E Customer 360 Prospect ${Date.now()}`;
    const companyId = (await client.query("INSERT INTO crm_companies (id, organization_id, name, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now()) RETURNING id", [platformOrgId, companyName])).rows[0].id as string;
    return { companyId, companyName };
  });
}

/**
 * The full pipeline: WON deal → ACCEPTED proposal → ACTIVE contract →
 * converted linked Organization → IN_PROGRESS onboarding with one
 * service item → a billing account on the linked org. Covers states
 * 2-5 (converted, onboarding, proposal/contract, billing) at once —
 * they are all naturally true together for a customer this far along,
 * not four independent fixtures.
 */
async function seedFullCustomerScenario(): Promise<{ companyId: string; companyName: string; onboardingId: string; linkedOrgId: string }> {
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const suffix = Date.now();
    const companyName = `E2E Customer 360 Full ${suffix}`;

    const companyId = (await client.query("INSERT INTO crm_companies (id, organization_id, name, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now()) RETURNING id", [platformOrgId, companyName])).rows[0].id as string;
    const pipelineId = (await client.query("SELECT id FROM crm_pipelines WHERE organization_id = $1 AND is_default = true", [platformOrgId])).rows[0].id as string;
    const wonStageId = (await client.query("SELECT id FROM crm_pipeline_stages WHERE pipeline_id = $1 AND is_won = true", [pipelineId])).rows[0].id as string;
    const dealId = (
      await client.query(
        "INSERT INTO crm_deals (id, organization_id, pipeline_id, stage_id, company_id, title, value_minor_units, currency, status, won_at, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 750000, 'USD', 'WON', now(), $6, now(), now()) RETURNING id",
        [platformOrgId, pipelineId, wonStageId, companyId, `${companyName} — deal`, adminUserId],
      )
    ).rows[0].id as string;

    const proposalId = (
      await client.query("INSERT INTO crm_proposals (id, organization_id, deal_id, company_id, proposal_number, status, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACCEPTED', $5, now(), now()) RETURNING id", [
        platformOrgId,
        dealId,
        companyId,
        `E2E-360-${suffix}`,
        adminUserId,
      ])
    ).rows[0].id as string;
    const versionId = (
      await client.query(
        "INSERT INTO crm_proposal_versions (id, organization_id, proposal_id, version_number, status, title, body_html, currency, subtotal_minor_units, discount_type, discounted_subtotal_minor_units, total_minor_units, valid_until, accepted_at, accepted_signer_name, accepted_signer_email, accepted_by_staff_user_id, acceptance_mechanism, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 1, 'ACCEPTED', 'E2E 360 Proposal', '<p>Body</p>', 'USD', 750000, 'NONE', 750000, 750000, now() + interval '30 days', now(), 'E2E Signer', 'signer@example.com', $3, 'INTERNAL_RECORDED', $3, now(), now()) RETURNING id",
        [platformOrgId, proposalId, adminUserId],
      )
    ).rows[0].id as string;
    await client.query("UPDATE crm_proposals SET current_version_id = $1 WHERE id = $2", [versionId, proposalId]);
    await client.query(
      "INSERT INTO crm_proposal_line_items (id, organization_id, version_id, title, quantity, unit_amount_minor_units, discount_type, line_total_minor_units, sort_order, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'Full-service SEO', 1, 750000, 'NONE', 750000, 0, now(), now())",
      [platformOrgId, versionId],
    );

    const contractId = (
      await client.query(
        "INSERT INTO crm_contracts (id, organization_id, deal_id, company_id, originating_proposal_id, originating_proposal_version_id, contract_number, status, effective_date, activated_at, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'ACTIVE', now(), now(), $7, now(), now()) RETURNING id",
        [platformOrgId, dealId, companyId, proposalId, versionId, `E2E-360-CTR-${suffix}`, adminUserId],
      )
    ).rows[0].id as string;

    const linkedOrgId = (
      await client.query("INSERT INTO organizations (id, name, display_name, slug, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $1, $2, 'ACTIVE', now(), now()) RETURNING id", [companyName, `e2e-360-linked-${suffix}`])
    ).rows[0].id as string;
    await client.query("UPDATE crm_companies SET converted_to_organization_id = $1 WHERE id = $2", [linkedOrgId, companyId]);

    const onboardingId = (
      await client.query(
        "INSERT INTO crm_client_onboardings (id, organization_id, deal_id, company_id, linked_organization_id, originating_contract_id, originating_proposal_id, status, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'IN_PROGRESS', $7, now(), now()) RETURNING id",
        [platformOrgId, dealId, companyId, linkedOrgId, contractId, proposalId, adminUserId],
      )
    ).rows[0].id as string;
    await client.query(
      "INSERT INTO crm_client_onboarding_service_items (id, organization_id, onboarding_id, title, quantity, onboarding_required, sort_order, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'Full-service SEO', 1, true, 0, now(), now())",
      [platformOrgId, onboardingId],
    );

    await client.query("INSERT INTO billing_accounts (id, organization_id, status, currency, provider, provider_customer_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, 'ACTIVE', 'USD', 'STRIPE', $2, now(), now())", [
      linkedOrgId,
      `cus_e2e_360_${suffix}`,
    ]);

    return { companyId, companyName, onboardingId, linkedOrgId };
  });
}

base.describe("Customer 360 — access control", () => {
  base("an unauthorized role (no crm.read) is denied the page", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");
    const { companyId } = await seedProspectCompany();
    await goto(page, `/admin/crm/customers/${companyId}`);
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("a customer-org member (not platform staff at all) is denied the page", async ({ page }) => {
    await loginAs(page, "customer@alpha-os.test");
    const { companyId } = await seedProspectCompany();
    await goto(page, `/admin/crm/customers/${companyId}`);
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });
});

base.describe("Customer 360 — representative states", () => {
  base("a prospect (no sales/onboarding activity) shows an honest empty state, not fabricated data", async ({ page }) => {
    const { companyId, companyName } = await seedProspectCompany();
    await loginAs(page, "platform-admin@alpha-os.test");
    await goto(page, `/admin/crm/customers/${companyId}`);
    await expect(page.getByRole("heading", { name: companyName, exact: true })).toBeVisible();
    // "Prospect" legitimately appears twice — the header status badge and
    // the Overview tab's own raw-health-indicators row — so this asserts
    // presence, not uniqueness.
    await expect(page.getByText("Prospect", { exact: true }).first()).toBeVisible();

    await page.getByRole("tab", { name: "Billing" }).click();
    await expect(page.getByText("Not yet a customer")).toBeVisible();

    await page.getByRole("tab", { name: "Onboarding" }).click();
    await expect(page.getByText("No onboarding engagement yet")).toBeVisible();

    await page.getByRole("tab", { name: "Projects / Support / Conversations" }).click();
    await expect(page.getByText("Not available yet").first()).toBeVisible();
  });

  base("a converted customer with onboarding, proposal/contract, and billing shows real composed data", async ({ page }) => {
    const { companyId, companyName, onboardingId } = await seedFullCustomerScenario();
    await loginAs(page, "platform-admin@alpha-os.test");
    await goto(page, `/admin/crm/customers/${companyId}`);
    await expect(page.getByRole("heading", { name: companyName, exact: true })).toBeVisible();
    await expect(page.getByText("Onboarding", { exact: true }).first()).toBeVisible();

    await page.getByRole("tab", { name: "Sales" }).click();
    await expect(page.getByText("E2E-360-", { exact: false }).first()).toBeVisible();

    await page.getByRole("tab", { name: "Onboarding" }).click();
    await expect(page.getByRole("link", { name: /Onboarding started/ })).toBeVisible();

    await page.getByRole("tab", { name: "Services" }).click();
    await expect(page.getByText("Full-service SEO")).toBeVisible();

    await page.getByRole("tab", { name: "Billing" }).click();
    await expect(page.getByText("ACTIVE", { exact: false }).first()).toBeVisible();

    await page.getByRole("tab", { name: "Activity" }).click();
    await expect(page.getByText("Deal", { exact: false }).first()).toBeVisible();

    await page.getByRole("tab", { name: "Documents" }).click();
    await expect(page.getByText("Contract E2E-360-CTR-", { exact: false })).toBeVisible();

    // Navigation FROM the onboarding page back to Customer 360.
    await goto(page, `/admin/crm/onboarding/${onboardingId}`);
    await page.getByRole("link", { name: "(Customer 360)" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/crm/customers/${companyId}$`));
  });
});

base.describe("Customer 360 — not-found and responsive behavior", () => {
  base("a nonexistent company shows not found, not a crash", async ({ page }) => {
    await loginAs(page, "platform-admin@alpha-os.test");
    await goto(page, `/admin/crm/customers/${MISSING_ID}`);
    await expect(page.getByText(/could not be found/i)).toBeVisible();
  });

  base("the workspace remains usable at mobile and tablet widths", async ({ page }) => {
    const { companyId, companyName } = await seedProspectCompany();
    await loginAs(page, "platform-admin@alpha-os.test");
    for (const viewport of [{ width: 375, height: 667 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      await goto(page, `/admin/crm/customers/${companyId}`);
      await expect(page.getByRole("heading", { name: companyName, exact: true })).toBeVisible();
    }
  });
});
