import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Proposals & Contracts E2E (Build 22 — Roadmap Module 16). Direct
 * style/helper template from `sales-team.spec.ts`/`sales-pipeline.spec.ts`
 * — see those files' own comments for the reasoning behind each shared
 * helper. Written directly by Claude (not drafted by Codex first) since
 * Codex's own sandbox cannot launch Chromium regardless.
 *
 * Every test creates its own fresh proposal/contract via the UI rather
 * than mutating the seeded fixtures (`seed-proposals.ts`'s own ACCEPTED/
 * SENT/DRAFT proposals) — the same "leave shared seed state exactly as
 * seeded" discipline `sales-team.spec.ts` documents, so this suite stays
 * re-runnable indefinitely without a database reset between runs.
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

async function openDealId(): Promise<string> {
  return withPgClient((client) =>
    client
      .query("SELECT d.id FROM crm_deals d WHERE d.title = $1 AND d.status = 'OPEN'", ["Technical SEO retainer — Globex Logistics"])
      .then((r) => r.rows[0].id as string),
  );
}

async function expectNoApplicationError(page: Page) {
  await expect(page.locator("body")).not.toContainText("Application error");
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  await expectNoApplicationError(page);
}

/** See `sales-team.spec.ts`'s own identical helper comment — Radix `SelectContent` portals to `document.body`. */
async function choose(scope: Page | Locator, label: string, option: string) {
  const rootPage = "page" in scope && typeof (scope as Locator).page === "function" ? (scope as Locator).page() : (scope as Page);
  await scope.getByLabel(label).click();
  await rootPage.getByRole("option", { name: option, exact: true }).click();
}

/** A unique title per test run — proposal numbers are sequential regardless, but a unique title keeps every assertion unambiguous against the seeded fixtures and any prior run's own leftovers. */
function uniqueTitle(base: string): string {
  return `${base} ${Date.now()}`;
}

async function fillNewProposalForm(page: Page, title: string, unitPrice: string) {
  // Wait for the client-side navigation to actually settle before typing
  // anything — filling immediately after `.click()` on the "New proposal"
  // link raced the in-flight Next.js route transition in practice (found
  // live): the Title field's own fill landed on a transient pre-navigation
  // render and was lost once the real page finished mounting, while later
  // fields (typed after enough time had passed) stuck normally.
  await expect(page).toHaveURL(/\/admin\/crm\/proposals\/new/);
  await page.getByLabel("Title").fill(title);
  await page.getByRole("textbox", { name: "Proposal body" }).fill("<p>Automated E2E proposal body.</p>");
  // `exact: true` — "Item"'s own label would otherwise substring-match
  // the row's "Remove line item 1" button aria-label too (found live).
  await page.getByLabel("Item", { exact: true }).first().fill("Implementation services");
  await page.getByLabel("Unit price").first().fill(unitPrice);
  await page.getByRole("button", { name: "Save proposal" }).click();
}

base.describe("Proposals & Contracts — access control", () => {
  base("support agent (no crm.proposal permission) is denied the list and detail pages", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");
    await goto(page, "/admin/crm/proposals");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("support admin (read-only) sees the list but no management controls", async ({ page }) => {
    await loginAs(page, "support-admin@alpha-os.test");
    await goto(page, "/admin/crm/proposals");
    await expect(page.getByRole("heading", { name: "Proposals", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Templates" })).toHaveCount(0);

    const dealId = await openDealId();
    await goto(page, `/admin/crm/deals/${dealId}`);
    await expect(page.getByRole("link", { name: "New proposal" })).toHaveCount(0);
  });
});

base.describe("Proposals & Contracts — full happy path (create -> send -> accept -> contract)", () => {
  base("creates a draft, edits it, sends it, records acceptance, and activates a resulting contract", async ({ page }) => {
    await loginAs(page, "platform-admin@alpha-os.test");
    const dealId = await openDealId();
    const title = uniqueTitle("E2E Full Lifecycle Proposal");

    await goto(page, `/admin/crm/deals/${dealId}`);
    await page.getByRole("link", { name: "New proposal" }).click();
    await expect(page).toHaveURL(/\/admin\/crm\/proposals\/new\?dealId=/);

    await fillNewProposalForm(page, title, "1000");
    await expect(page).toHaveURL(/\/admin\/crm\/proposals\/[0-9a-f-]+$/);
    await expectNoApplicationError(page);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByText("DRAFT", { exact: true }).first()).toBeVisible();

    // Edit the draft — add a second line item.
    await page.getByRole("link", { name: "Edit draft" }).click();
    await page.getByRole("button", { name: "Add line item" }).click();
    await page.getByLabel("Item", { exact: true }).nth(1).fill("Ongoing support retainer");
    await page.getByLabel("Unit price").nth(1).fill("250");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expectNoApplicationError(page);
    await expect(page.getByText("$1,250.00").first()).toBeVisible();

    // Send.
    await page.getByRole("button", { name: "Mark as sent" }).click();
    await expect(page.getByText("SENT", { exact: true }).first()).toBeVisible();

    // Record acceptance.
    await page.getByLabel("Signer name").fill("Priya Nair");
    await page.getByLabel("Signer email").fill("priya.nair@globexlogistics.example");
    await page.getByRole("button", { name: "Record acceptance" }).click();
    await expect(page.getByText("ACCEPTED", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/By Priya Nair/)).toBeVisible();

    // Create and activate a contract from this now-accepted proposal.
    await page.getByRole("link", { name: "Create contract" }).click();
    await expect(page).toHaveURL(/\/admin\/crm\/contracts\/new\?proposalId=/);
    await page.getByRole("button", { name: "Create contract" }).click();
    await expect(page).toHaveURL(/\/admin\/crm\/contracts\/[0-9a-f-]+$/);
    await expect(page.getByText("DRAFT", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Activate" }).click();
    await expect(page.getByText("ACTIVE", { exact: true }).first()).toBeVisible();
  });
});

base.describe("Proposals & Contracts — approval path", () => {
  base("hides self-approval, and a second approver can approve a submitted proposal", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    const dealId = await openDealId();
    const title = uniqueTitle("E2E Approval Path Proposal");

    await goto(page, `/admin/crm/deals/${dealId}`);
    await page.getByRole("link", { name: "New proposal" }).click();
    await fillNewProposalForm(page, title, "5000");

    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.getByText("PENDING", { exact: true }).first()).toBeVisible();
    // Self-approval control must be hidden for the submitter.
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    const url = page.url();

    await loginAs(page, "platform-admin@alpha-os.test");
    await goto(page, url);
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("APPROVED", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Mark as sent" }).click();
    await expect(page.getByText("SENT", { exact: true }).first()).toBeVisible();
  });
});

base.describe("Proposals & Contracts — revision and rejection", () => {
  base("revises a rejected proposal into a new draft version", async ({ page }) => {
    await loginAs(page, "platform-admin@alpha-os.test");
    const dealId = await openDealId();
    const title = uniqueTitle("E2E Revision Path Proposal");

    await goto(page, `/admin/crm/deals/${dealId}`);
    await page.getByRole("link", { name: "New proposal" }).click();
    await fillNewProposalForm(page, title, "800");
    await page.getByRole("button", { name: "Mark as sent" }).click();
    await expect(page.getByText("SENT", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Record customer rejection" }).click();
    await page.getByLabel("Rejection reason").fill("Budget was cut for this quarter.");
    await page.getByRole("button", { name: "Confirm rejection" }).click();
    await expect(page.getByText("REJECTED", { exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Revise (new version)" }).click();
    await expect(page).toHaveURL(/\/admin\/crm\/proposals\/[0-9a-f-]+\/revise$/);
    const revisedTitle = `${title} (revised)`;
    await page.getByLabel("Title").fill(revisedTitle);
    await page.getByRole("button", { name: "Create new version" }).click();
    await expectNoApplicationError(page);
    await expect(page.getByRole("heading", { name: revisedTitle, exact: true })).toBeVisible();
    await expect(page.getByText("DRAFT", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/v2\s*\(current\)/)).toBeVisible();
  });
});

base.describe("Proposals & Contracts — templates", () => {
  base("creates a template and uses it to pre-fill a new proposal", async ({ page }) => {
    await loginAs(page, "platform-admin@alpha-os.test");
    const templateName = uniqueTitle("E2E Template");

    await goto(page, "/admin/crm/proposals/templates");
    await page.getByLabel("Template name").fill(templateName);
    await page.getByLabel("Default proposal title").fill("Default E2E Title");
    await page.getByRole("textbox", { name: "Default proposal body" }).fill("<p>Default body.</p>");
    await page.getByRole("button", { name: "Create template" }).click();
    await expectNoApplicationError(page);
    await expect(page.getByText(templateName, { exact: true })).toBeVisible();

    const dealId = await openDealId();
    await goto(page, `/admin/crm/proposals/new?dealId=${dealId}`);
    await choose(page, "Start from a template", templateName);
    await expect(page.getByLabel("Title")).toHaveValue("Default E2E Title");
  });
});

base.describe("Proposals & Contracts — not-found and responsive behavior", () => {
  base("a nonexistent proposal shows not found, not a crash", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto(`/admin/crm/proposals/${MISSING_ID}`);
    await expectNoApplicationError(page);
  });

  base("the proposals list remains usable at mobile and tablet widths", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      await goto(page, "/admin/crm/proposals");
      await expect(page.getByRole("heading", { name: "Proposals", exact: true })).toBeVisible();
    }
  });
});
