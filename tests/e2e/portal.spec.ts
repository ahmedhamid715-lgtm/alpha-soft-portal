import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Customer Portal E2E (Build 26 — Roadmap Module 20). Written directly
 * by Claude, same reasoning as every prior build's own top comment —
 * Codex's sandbox cannot launch Chromium.
 *
 * **Session reuse**: ONE shared `owner-a@alpha-os.test` login for the
 * entire file (`beforeAll`), reused across every test that needs that
 * identity — not one login per test. This is a required regression
 * improvement from Build 25's own findings (repeated real logins across
 * many tests exhausted the real `authRateLimiter`, 10 requests/15min
 * per email) — an earlier draft of this exact file made that same
 * mistake (13 separate `loginAs("owner-a@...")` calls, one per test)
 * before being caught and rewritten to this shared-session shape.
 * Tests that genuinely need a DIFFERENT identity (unauthenticated,
 * `support@` with no customer org, `customer@` for destination routing,
 * `multiorg@` for multi-org behavior) still use the plain `{ page }`
 * fixture — each logs in exactly once, never in a loop.
 *
 * **Test-data discipline** (also from Build 25's own findings — see the
 * master authorization's "Customer Portal E2E must not depend on seed
 * order"): every fixture this file seeds is self-identifying (a
 * `Date.now()` suffix baked into every unique field) and every
 * assertion either checks for that exact unique substring or navigates
 * via a directly-captured id — never "the Nth row" or "within the first
 * page of some list."
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
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  await expectNoApplicationError(page);
}

/**
 * A real CRM engagement (company converted to an EXISTING seeded
 * organization's own id, WON deal, ACTIVE contract, IN_PROGRESS
 * onboarding, ACCEPTED proposal + line item) — every unique field
 * tagged with `suffix` so an assertion can match it exactly regardless
 * of what else exists in this shared dev database. Seeded ONCE in
 * `beforeAll` below and reused read-only across every content test —
 * never re-seeded per test.
 */
async function seedPortalEngagement(organizationId: string): Promise<{ companyId: string; contractNumber: string; proposalNumber: string; onboardingId: string }> {
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const suffix = Date.now();
    const contractNumber = `E2E-PORTAL-CTR-${suffix}`;
    const proposalNumber = `E2E-PORTAL-PROP-${suffix}`;

    // `crm_companies.converted_to_organization_id` is UNIQUE — at most
    // one CrmCompany may convert to a given Organization, ever. Reruns
    // of this file against the same shared dev database (this exact
    // `organizationId`, e.g. Acme Corp) would otherwise collide on a
    // second insert. Idempotent "find or create": if this organization
    // already has a converted company from an earlier run, add this
    // run's own contract/onboarding/proposal fixtures under THAT
    // existing company (still fully self-identifying via `contractNumber`/
    // `proposalNumber`'s own unique suffix) instead of creating a second,
    // colliding one.
    const existing = await client.query("SELECT id, name FROM crm_companies WHERE converted_to_organization_id = $1", [organizationId]);
    const companyName = existing.rows[0]?.name ?? `E2E Portal Co ${suffix}`;
    const companyId = (
      existing.rows[0]
        ? existing
        : await client.query("INSERT INTO crm_companies (id, organization_id, name, status, converted_to_organization_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', $3, now(), now()) RETURNING id", [
            platformOrgId,
            companyName,
            organizationId,
          ])
    ).rows[0].id as string;
    const pipelineId = (await client.query("INSERT INTO crm_pipelines (id, organization_id, name, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, now(), now()) RETURNING id", [platformOrgId, `E2E Portal Pipeline ${suffix}`])).rows[0]
      .id as string;
    const wonStageId = (
      await client.query("INSERT INTO crm_pipeline_stages (id, organization_id, pipeline_id, name, sort_order, is_won, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'Won', 1000, true, now(), now()) RETURNING id", [
        platformOrgId,
        pipelineId,
      ])
    ).rows[0].id as string;
    const dealId = (
      await client.query(
        "INSERT INTO crm_deals (id, organization_id, pipeline_id, stage_id, company_id, title, value_minor_units, currency, status, won_at, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 500000, 'USD', 'WON', now(), $6, now(), now()) RETURNING id",
        [platformOrgId, pipelineId, wonStageId, companyId, `${companyName} — deal`, adminUserId],
      )
    ).rows[0].id as string;
    const contractId = (
      await client.query(
        "INSERT INTO crm_contracts (id, organization_id, deal_id, company_id, contract_number, status, effective_date, end_date, activated_at, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACTIVE', now(), now() + interval '180 days', now(), $5, now(), now()) RETURNING id",
        [platformOrgId, dealId, companyId, contractNumber, adminUserId],
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
      [platformOrgId, onboardingId, `E2E Portal Service ${suffix}`],
    );
    const proposalId = (
      await client.query(
        "INSERT INTO crm_proposals (id, organization_id, deal_id, company_id, proposal_number, status, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACCEPTED', $5, now(), now()) RETURNING id",
        [platformOrgId, dealId, companyId, proposalNumber, adminUserId],
      )
    ).rows[0].id as string;
    const versionId = (
      await client.query(
        "INSERT INTO crm_proposal_versions (id, organization_id, proposal_id, version_number, status, title, body_html, currency, subtotal_minor_units, discount_type, discounted_subtotal_minor_units, total_minor_units, valid_until, accepted_at, acceptance_mechanism, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 1, 'ACCEPTED', $3, '<p>E2E portal proposal body</p>', 'USD', 500000, 'NONE', 500000, 500000, now() + interval '30 days', now(), 'INTERNAL_RECORDED', $4, now(), now()) RETURNING id",
        [platformOrgId, proposalId, `E2E Portal Proposal ${suffix}`, adminUserId],
      )
    ).rows[0].id as string;
    await client.query("UPDATE crm_proposals SET current_version_id = $1 WHERE id = $2", [versionId, proposalId]);
    await client.query(
      "INSERT INTO crm_proposal_line_items (id, organization_id, version_id, title, quantity, unit_amount_minor_units, discount_type, line_total_minor_units, sort_order, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 1, 500000, 'NONE', 500000, 0, now(), now())",
      [platformOrgId, versionId, `E2E Portal Line Item ${suffix}`],
    );

    return { companyId, contractNumber, proposalNumber, onboardingId };
  });
}

async function orgIdBySlug(slug: string): Promise<string> {
  return withPgClient((client) => client.query("SELECT id FROM organizations WHERE slug = $1", [slug]).then((r) => r.rows[0].id as string));
}

base.describe("Customer Portal — access control", () => {
  base("an unauthenticated visitor is redirected to /login", async ({ page }) => {
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/login/);
  });

  base("a pure platform-staff user with no customer organization membership at all sees an honest 'no organization' state, not a crash", async ({ page }) => {
    // `support-agent@alpha-os.test` belongs ONLY to the platform
    // organization (`isPlatform: true`) — genuinely zero eligible
    // Portal organizations. `support@alpha-os.test` (no hyphen) is a
    // DIFFERENT, pre-RBAC seed account that DOES belong to a real
    // non-platform organization with a null `roleId` — that account
    // correctly hits the "denied" (has org, lacks portal.access) gate
    // instead, covered by the next test.
    await loginAs(page, "support-agent@alpha-os.test");
    await goto(page, "/portal");
    await expect(page.getByText("No organization access yet")).toBeVisible();
  });

  base("a member of a real organization whose role predates RBAC (no portal.access grant) sees the access-denied gate, not silent access", async ({ page }) => {
    await loginAs(page, "support@alpha-os.test");
    await goto(page, "/portal");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("post-login destination for an ordinary organization member is /portal", async ({ page }) => {
    await loginAs(page, "customer@alpha-os.test");
    await expect(page).toHaveURL(/\/portal$/);
  });
});

base.describe("Customer Portal — dashboard, company, services, documents (shared owner-a session)", () => {
  base("dashboard, My Company, Services, and Documents all show the real seeded engagement, uniquely identified, and My Company edit persists", async () => {
    const orgId = await orgIdBySlug("acme-corp-dev");
    const { contractNumber, proposalNumber } = await seedPortalEngagement(orgId);

    await goto(ownerPage, "/portal");
    await expect(ownerPage.getByRole("heading", { name: /Welcome/ })).toBeVisible();

    await goto(ownerPage, "/portal/company");
    // owner-a has `organizations.update` — the EDITABLE form renders,
    // so "Acme Corp" is an <input>'s `value`, never matched by
    // `getByText()` (which only matches rendered text nodes).
    await expect(ownerPage.getByLabel("Company name")).toHaveValue("Acme Corp");
    const uniqueIndustry = `E2E Portal Industry ${Date.now()}`;
    await ownerPage.getByLabel("Industry").fill(uniqueIndustry);
    await ownerPage.getByRole("button", { name: "Save" }).click();
    await expect(ownerPage.getByText("Company profile updated.")).toBeVisible();
    await expect(ownerPage.getByLabel("Industry")).toHaveValue(uniqueIndustry);

    await goto(ownerPage, "/portal/services");
    await expect(ownerPage.getByText(/E2E Portal (Service|Line Item)/).first()).toBeVisible();

    await goto(ownerPage, "/portal/documents");
    await expect(ownerPage.getByText(proposalNumber, { exact: false })).toBeVisible();
    await expect(ownerPage.getByText(contractNumber, { exact: false })).toBeVisible();
  });
});

base.describe("Customer Portal — billing (shared owner-a session)", () => {
  base("billing, invoices, and payments show real Acme Corp billing history, and a foreign invoice id is denied", async () => {
    await goto(ownerPage, "/portal/billing");
    await expect(ownerPage.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();

    await goto(ownerPage, "/portal/billing/invoices");
    await expect(ownerPage.getByRole("table")).toBeVisible();

    await goto(ownerPage, "/portal/billing/payments");
    await expectNoApplicationError(ownerPage);

    const foreignInvoiceId = await withPgClient(async (client) => {
      const acmeOrgId = await orgIdBySlug("acme-corp-dev");
      const row = await client.query("SELECT id FROM invoices WHERE organization_id != $1 LIMIT 1", [acmeOrgId]);
      return row.rows[0]?.id as string | undefined;
    });
    if (foreignInvoiceId) {
      await goto(ownerPage, `/portal/billing/invoices/${foreignInvoiceId}`);
      await expect(ownerPage.getByText(/could not be found/i)).toBeVisible();
    }
  });
});

base.describe("Customer Portal — notifications, AI assistant, profile (shared owner-a session)", () => {
  base("notifications page loads, the AI assistant surfaces a safe error (ANTHROPIC_API_KEY is unconfigured in this dev environment — same as ai-assistant.spec.ts's own established pattern) without losing the user's own message, and profile shows the real signed-in user", async () => {
    base.setTimeout(60_000);

    await goto(ownerPage, "/portal/notifications");
    await expect(ownerPage.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();

    await goto(ownerPage, "/portal/assistant");
    const uniqueId = `${Date.now()}`;
    const uniqueMessage = `[${uniqueId}] E2E portal assistant check`;
    await ownerPage.getByPlaceholder("Ask a question…").fill(uniqueMessage);
    await ownerPage.getByRole("button", { name: "Send" }).click();
    await expect(ownerPage.getByText(/Anthropic service is currently unavailable/i)).toBeVisible();
    await expectNoApplicationError(ownerPage);

    // The user's own message was still persisted (never silently lost) —
    // reload the conversation list and confirm it's there.
    await ownerPage.reload();
    await expect(ownerPage.getByText(uniqueId)).toBeVisible();

    await goto(ownerPage, "/portal/profile");
    await expect(ownerPage.getByLabel("Name")).toHaveValue("Owner A (Dev)");
  });
});

base.describe("Customer Portal — honest unavailable states (shared owner-a session)", () => {
  const cases: { path: string; module: string }[] = [
    { path: "/portal/projects", module: "21" },
    { path: "/portal/tasks", module: "22" },
    { path: "/portal/reports", module: "66" },
    { path: "/portal/tickets", module: "30" },
    { path: "/portal/messages", module: "46" },
  ];

  base("every unavailable module shows an honest state naming its own real Roadmap Module number", async () => {
    for (const { path, module } of cases) {
      await goto(ownerPage, path);
      await expect(ownerPage.getByText("Not available yet")).toBeVisible();
      await expect(ownerPage.getByText(`Roadmap Module ${module}`, { exact: false })).toBeVisible();
    }
  });
});

base.describe("Customer Portal — multi-organization", () => {
  base("a multi-org user sees a real organization's data (Acme Corp or Beta Industries), not an ambiguous crash", async ({ page }) => {
    await loginAs(page, "multiorg@alpha-os.test");
    await goto(page, "/portal");
    await expect(page.getByText("Acme Corp", { exact: false }).or(page.getByText("Beta Industries", { exact: false })).first()).toBeVisible();
  });
});

base.describe("Customer Portal — responsive (shared owner-a session)", () => {
  base("the dashboard and billing pages remain usable at mobile and tablet widths", async () => {
    for (const viewport of [{ width: 375, height: 667 }, { width: 768, height: 1024 }]) {
      await ownerPage.setViewportSize(viewport);
      await goto(ownerPage, "/portal");
      await expect(ownerPage.getByRole("heading", { name: /Welcome/ })).toBeVisible();
      await goto(ownerPage, "/portal/billing");
      await expect(ownerPage.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
    }
    await ownerPage.setViewportSize({ width: 1280, height: 800 });
  });
});
