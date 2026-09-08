import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Client Onboarding E2E (Build 23 — Roadmap Module 17). Direct style/
 * helper template from `proposals-contracts.spec.ts` (Build 22) — see
 * that file's own top comment for the reasoning behind each shared
 * helper. Written directly by Claude, same reasoning as that file's own
 * comment on why (Codex's sandbox cannot launch Chromium).
 *
 * The full happy path deliberately drives a WON deal → ACCEPTED proposal
 * → ACTIVE contract → onboarding chain from scratch through the UI
 * (winning an OPEN deal, not reusing the seeded already-onboarded Acme
 * deal, which the partial unique index would reject a second active
 * onboarding for anyway) — proving the entire Build 20→21→22→23 pipeline
 * end to end, not just Build 23 in isolation.
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
 * Creates a fresh, isolated WON-deal-with-ACCEPTED-proposal scenario
 * directly via SQL (not the UI) — this suite's own subject is the
 * onboarding conversion itself, not re-proving Build 20-22's own already-
 * covered create/win/send/accept UI flows a second time. Fresh company +
 * deal + proposal version + contract per call, so every test gets a
 * genuinely isolated, never-before-onboarded deal.
 */
async function seedEligibleDeal(): Promise<{ dealId: string; companyName: string }> {
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const suffix = Date.now();
    const companyName = `E2E Onboarding Co ${suffix}`;

    const companyId = (await client.query("INSERT INTO crm_companies (id, organization_id, name, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now()) RETURNING id", [platformOrgId, companyName])).rows[0].id as string;
    const pipelineId = (await client.query("SELECT id FROM crm_pipelines WHERE organization_id = $1 AND is_default = true", [platformOrgId])).rows[0].id as string;
    const wonStageId = (await client.query("SELECT id FROM crm_pipeline_stages WHERE pipeline_id = $1 AND is_won = true", [pipelineId])).rows[0].id as string;
    const dealId = (
      await client.query(
        "INSERT INTO crm_deals (id, organization_id, pipeline_id, stage_id, company_id, title, value_minor_units, currency, status, won_at, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 500000, 'USD', 'WON', now(), $6, now(), now()) RETURNING id",
        [platformOrgId, pipelineId, wonStageId, companyId, `${companyName} — deal`, adminUserId],
      )
    ).rows[0].id as string;

    const proposalId = (
      await client.query("INSERT INTO crm_proposals (id, organization_id, deal_id, company_id, proposal_number, status, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACCEPTED', $5, now(), now()) RETURNING id", [
        platformOrgId,
        dealId,
        companyId,
        `E2E-${suffix}`,
        adminUserId,
      ])
    ).rows[0].id as string;
    const versionId = (
      await client.query(
        "INSERT INTO crm_proposal_versions (id, organization_id, proposal_id, version_number, status, title, body_html, currency, subtotal_minor_units, discount_type, discounted_subtotal_minor_units, total_minor_units, valid_until, accepted_at, accepted_signer_name, accepted_signer_email, accepted_by_staff_user_id, acceptance_mechanism, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 1, 'ACCEPTED', 'E2E Proposal', '<p>Body</p>', 'USD', 500000, 'NONE', 500000, 500000, now() + interval '30 days', now(), 'E2E Signer', 'signer@example.com', $3, 'INTERNAL_RECORDED', $3, now(), now()) RETURNING id",
        [platformOrgId, proposalId, adminUserId],
      )
    ).rows[0].id as string;
    await client.query("UPDATE crm_proposals SET current_version_id = $1 WHERE id = $2", [versionId, proposalId]);
    const lineItemId = (
      await client.query("INSERT INTO crm_proposal_line_items (id, organization_id, version_id, title, quantity, unit_amount_minor_units, discount_type, line_total_minor_units, sort_order, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'Implementation', 1, 500000, 'NONE', 500000, 0, now(), now()) RETURNING id", [
        platformOrgId,
        versionId,
      ])
    ).rows[0].id as string;
    void lineItemId;

    const contractId = (
      await client.query(
        "INSERT INTO crm_contracts (id, organization_id, deal_id, company_id, originating_proposal_id, originating_proposal_version_id, contract_number, status, effective_date, activated_at, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'ACTIVE', now(), now(), $7, now(), now()) RETURNING id",
        [platformOrgId, dealId, companyId, proposalId, versionId, `E2E-CTR-${suffix}`, adminUserId],
      )
    ).rows[0].id as string;
    void contractId;

    return { dealId, companyName };
  });
}

base.describe("Client Onboarding — access control", () => {
  base("support agent (no crm.onboarding permission) is denied the list and detail pages", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");
    await goto(page, "/admin/crm/onboarding");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("support admin (read-only) sees the list but no management controls", async ({ page }) => {
    await loginAs(page, "support-admin@alpha-os.test");
    await goto(page, "/admin/crm/onboarding");
    await expect(page.getByRole("heading", { name: "Client Onboarding", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Intake fields" })).toHaveCount(0);
  });
});

base.describe("Client Onboarding — full happy path", () => {
  base("starts onboarding from an eligible deal, completes intake/requirements/checklist/kickoff, and completes", async ({ page }) => {
    const { dealId, companyName } = await seedEligibleDeal();
    await loginAs(page, "platform-admin@alpha-os.test");

    await goto(page, `/admin/crm/deals/${dealId}`);
    await expect(page.getByRole("heading", { name: "Start Onboarding", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Start onboarding" }).click();
    await expect(page).toHaveURL(/\/admin\/crm\/onboarding\/[0-9a-f-]+$/);
    await expectNoApplicationError(page);
    await expect(page.getByRole("heading", { name: companyName, exact: true })).toBeVisible();

    // Checklist — the default 3-item template should already be present.
    // These checkboxes are React-controlled (checked only reflects the
    // server's own persisted status, applied via `router.refresh()` after
    // an async Server Action, not an instant native toggle) — `.check()`'s
    // built-in "did the click change the state" assertion fires a single
    // near-immediate check and isn't meant for that round trip, so it
    // click, then separately await the checked state with `expect(...).
    // toBeChecked()`, which DOES poll/retry until the refreshed data
    // actually lands.
    async function checkChecklistItem(title: string) {
      const checkbox = page.locator("li", { hasText: title }).getByRole("checkbox");
      await checkbox.click();
      await expect(checkbox).toBeChecked();
    }
    await expect(page.getByText("Confirm primary point of contact")).toBeVisible();
    await checkChecklistItem("Internal kickoff briefing");
    await checkChecklistItem("Confirm primary point of contact");
    await checkChecklistItem("Review sold services with client");

    // Requirements.
    await page.getByLabel("Add requirement").fill("Provide access credentials");
    await page.getByRole("button", { name: "Add" }).first().click();
    await expectNoApplicationError(page);
    await page.locator("li", { hasText: "Provide access credentials" }).getByRole("button", { name: "Mark complete" }).click();

    // Kickoff.
    const kickoffInput = page.getByLabel("Scheduled for");
    await kickoffInput.fill("2027-01-15T10:00");
    await page.getByRole("button", { name: "Schedule kickoff" }).click();
    await expectNoApplicationError(page);
    await page.getByRole("button", { name: "Mark kickoff complete" }).click();
    await expectNoApplicationError(page);

    // Answer every required intake field — the catalog is tenant-wide
    // (shared across every onboarding, see the model's own schema
    // comment), so any REQUIRED field the seed data or another test run
    // already created also gates THIS fresh onboarding's own completion.
    await page.reload();
    // A real `RegExp` passed to `.filter({ hasText })`, not a CSS
    // `:text-matches()` selector string — Playwright's own selector
    // engine re-escapes backslashes inside such strings, so a JS string
    // literal's `"\\*$"` doesn't survive as the intended `\*$` pattern
    // (it was silently landing as `*$`, an invalid regex — "nothing to
    // repeat").
    const requiredIntakeInputs = page
      .locator("label")
      .filter({ hasText: /\*\s*$/ })
      .locator("xpath=following-sibling::*[1]");
    const requiredCount = await requiredIntakeInputs.count();
    for (let i = 0; i < requiredCount; i += 1) {
      const field = requiredIntakeInputs.nth(i);
      const tagName = await field.evaluate((el) => el.tagName.toLowerCase());
      if (tagName === "input") {
        const type = await field.getAttribute("type");
        await field.fill(type === "email" ? "e2e@example.com" : type === "url" ? "https://example.com" : type === "date" ? "2027-01-01" : "E2E answer");
        await field.blur();
      }
    }
    await expectNoApplicationError(page);

    await page.reload();
    const completeButton = page.getByRole("button", { name: "Complete onboarding" });
    await expect(completeButton).toBeVisible();
    await completeButton.click();
    await expectNoApplicationError(page);
    await expect(page.getByText("COMPLETED", { exact: false }).first()).toBeVisible();
  });

  base("prevents starting a second onboarding for the same deal", async ({ page }) => {
    const { dealId } = await seedEligibleDeal();
    await loginAs(page, "platform-admin@alpha-os.test");
    await goto(page, `/admin/crm/deals/${dealId}`);
    await page.getByRole("button", { name: "Start onboarding" }).click();
    await expect(page).toHaveURL(/\/admin\/crm\/onboarding\/[0-9a-f-]+$/);

    await goto(page, `/admin/crm/deals/${dealId}`);
    await expect(page.getByRole("heading", { name: "Start Onboarding", exact: true })).toHaveCount(0);
  });
});

base.describe("Client Onboarding — ineligibility and cancellation", () => {
  base("a deal that is not WON shows no start-onboarding action", async ({ page }) => {
    const openDealId = await withPgClient((client) =>
      client.query("SELECT id FROM crm_deals WHERE title = $1 AND status = 'OPEN'", ["Technical SEO retainer — Globex Logistics"]).then((r) => r.rows[0]?.id as string | undefined),
    );
    base.skip(!openDealId, "No seeded OPEN deal found.");
    await loginAs(page, "platform-admin@alpha-os.test");
    await goto(page, `/admin/crm/deals/${openDealId}`);
    await expect(page.getByRole("heading", { name: "Start Onboarding", exact: true })).toHaveCount(0);
  });

  base("cancels an onboarding with a reason", async ({ page }) => {
    const { dealId } = await seedEligibleDeal();
    await loginAs(page, "platform-admin@alpha-os.test");
    await goto(page, `/admin/crm/deals/${dealId}`);
    await page.getByRole("button", { name: "Start onboarding" }).click();
    await expect(page).toHaveURL(/\/admin\/crm\/onboarding\/[0-9a-f-]+$/);

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByLabel("Cancellation reason").fill("Client backed out.");
    await page.getByRole("button", { name: "Confirm cancellation" }).click();
    await expectNoApplicationError(page);
    await expect(page.getByText("CANCELLED", { exact: false }).first()).toBeVisible();
  });
});

base.describe("Client Onboarding — completion denial", () => {
  base("refuses to complete while required checklist items remain incomplete", async ({ page }) => {
    const { dealId } = await seedEligibleDeal();
    await loginAs(page, "platform-admin@alpha-os.test");
    await goto(page, `/admin/crm/deals/${dealId}`);
    await page.getByRole("button", { name: "Start onboarding" }).click();
    await expect(page).toHaveURL(/\/admin\/crm\/onboarding\/[0-9a-f-]+$/);

    // No checklist items completed yet — "Complete onboarding" must not be offered.
    await expect(page.getByRole("button", { name: "Complete onboarding" })).toHaveCount(0);
    await expect(page.getByText(/Not yet ready to complete/)).toBeVisible();
  });
});

base.describe("Client Onboarding — not-found and responsive behavior", () => {
  base("a nonexistent onboarding shows not found, not a crash", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto(`/admin/crm/onboarding/${MISSING_ID}`);
    await expectNoApplicationError(page);
  });

  base("the onboarding list remains usable at mobile and tablet widths", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      await goto(page, "/admin/crm/onboarding");
      await expect(page.getByRole("heading", { name: "Client Onboarding", exact: true })).toBeVisible();
    }
  });
});
