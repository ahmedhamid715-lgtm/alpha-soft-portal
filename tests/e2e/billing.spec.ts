import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Module 13 (Enterprise Billing) E2E — customer-facing billing surfaces,
 * real browser, real running app, real database, against a production
 * build. Business-rule coverage (permission gating, IDOR, financial
 * integrity) is already proven at the database/service layer in
 * `tests/integration/db/*.test.ts`; this file's job is proving the real
 * UI is wired to that service layer and reachable for each persona.
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);
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

async function orgIdBySlug(slug: string): Promise<string> {
  return withPgClient((client) => client.query("SELECT id FROM organizations WHERE slug = $1", [slug]).then((r) => r.rows[0].id as string));
}

base.describe("Billing (customer)", () => {
  base("owner sees the billing dashboard with the seeded Growth subscription", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/billing`);

    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    // `{ exact: true }` (Module 14) — the "change plan" dropdown added
    // to this page also lists "Growth" as an option label (with its
    // price suffix), which a loose substring match against "Growth"
    // now also resolves to; the current-plan metric card's text is
    // exactly "Growth" with nothing else, so exact match disambiguates.
    await expect(page.getByText("Growth", { exact: true })).toBeVisible();
    await expect(page.getByText("ACTIVE")).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage payment method" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel subscription" })).toBeVisible();
  });

  base("admin (billing.read only) sees the dashboard read-only — no cancel/manage controls", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "admin-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/billing`);

    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await expect(page.getByText("Growth")).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage payment method" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel subscription" })).toHaveCount(0);
    await expect(page.getByText("requires the organization owner")).toBeVisible();
  });

  base("a member without billing.read is denied", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "member-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/billing`);
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("Org B's owner cannot reach Org A's billing by forging the URL (cross-tenant IDOR)", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "owner-b@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/billing`);
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("invoice history lists the seeded paid invoice; the detail page shows its immutable line item", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/billing/invoices`);

    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
    const invoiceLink = page.locator("table a[href*='/billing/invoices/']").first();
    await expect(invoiceLink).toBeVisible();
    await expect(page.getByText("PAID")).toBeVisible();

    await invoiceLink.click();
    await expect(page.getByText("Growth — monthly")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Line items" })).toBeVisible();
  });

  base("a forged invoice id under the correct organization returns not found, never another organization's data", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "owner-a@alpha-os.test");
    const res = await page.goto(`/organizations/${orgAId}/billing/invoices/00000000-0000-0000-0000-000000000000`);
    expect(res?.status()).toBe(404);
  });
});
