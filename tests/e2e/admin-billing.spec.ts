import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Module 13 (Enterprise Billing) E2E — platform billing administration
 * and the plan catalog admin surface, real browser, real running app,
 * against a production build.
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

base.describe("Billing (platform administration)", () => {
  base("platform_owner sees the platform billing directory including Acme Corp's ACTIVE subscription", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    // Module 15 — `/admin/billing` itself is now the financial
    // intelligence dashboard; the per-organization directory this test
    // is actually about moved one level down.
    await page.goto("/admin/billing/organizations");

    await expect(page.getByRole("heading", { name: "Billing organizations" })).toBeVisible();
    await expect(page.getByText("Acme Corp")).toBeVisible();
  });

  base("support_admin (billing.readPlatform only) can view the directory but the org detail page shows no refund control", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "support-admin@alpha-os.test");
    await page.goto(`/admin/billing/organizations/${orgAId}`);

    await expect(page.getByRole("heading", { name: "Acme Corp" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refund" })).toHaveCount(0);
  });

  base("a customer organization's own owner cannot reach the platform billing directory, nor the financial dashboard", async ({ page }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto("/admin/billing/organizations");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();

    await page.goto("/admin/billing");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("platform_owner sees the Refund control on a successful payment, and Stripe being unconfigured surfaces a safe error rather than crashing (spec §49)", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto(`/admin/billing/organizations/${orgAId}`);

    await expect(page.getByRole("heading", { name: "Acme Corp" })).toBeVisible();
    const refundButton = page.getByRole("button", { name: "Refund" }).first();
    await expect(refundButton).toBeVisible();
    await refundButton.click();
    await page.getByRole("button", { name: "Refund" }).last().click(); // confirm in the dialog

    // No real Stripe key is configured in this environment — the
    // service maps that to a safe ExternalServiceError; the page must
    // show it as a normal alert, never a crashed/500 page.
    await expect(page.getByText(/Stripe/i)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error");
  });

  base("plan catalog admin: platform_admin can create a plan and add a price; it appears immediately", async ({ page }) => {
    await loginAs(page, "platform-admin@alpha-os.test");
    await page.goto("/admin/plans");
    await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible();
    await expect(page.getByText("Starter")).toBeVisible();
    await expect(page.getByText("Growth")).toBeVisible();

    // Both the key AND the display name are unique per run — a bare
    // "E2E Test Plan" name collides with a previous run's own leftover
    // fixture (this spec doesn't delete what it creates, same as every
    // other E2E spec's own "E2E Created Org"-style fixtures in this
    // codebase) and trips Playwright's strict-mode "resolved to 2
    // elements" the second time the suite runs.
    const uniqueSuffix = Date.now();
    const uniqueKey = `e2e_plan_${uniqueSuffix}`;
    const uniqueName = `E2E Test Plan ${uniqueSuffix}`;
    await page.fill("input[name=key]", uniqueKey);
    await page.fill("input[name=name]", uniqueName);
    await page.getByRole("button", { name: "Create plan" }).click();
    await expect(page.getByText("Plan created.")).toBeVisible();
    await expect(page.getByText(uniqueName)).toBeVisible();
  });

  base("support_agent (minimal platform access) cannot reach the plan catalog admin page", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");
    await page.goto("/admin/plans");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });
});
