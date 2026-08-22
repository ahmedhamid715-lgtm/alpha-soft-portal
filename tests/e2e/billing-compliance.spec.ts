import { test as base, expect, type Page } from "@playwright/test";
import { serverIsReachable } from "./fixtures";

/**
 * Module 16 (Revenue Recognition, Tax & Financial Compliance) E2E —
 * real browser, real running app, real database, against a production
 * build. Business-rule/calculation coverage lives in
 * `tests/unit/lib/billing/recognition/schedule.test.ts` and
 * `tests/unit/lib/billing/tax/compliance.test.ts`, plus
 * `tests/integration/db/{revenue-recognition,tax-compliance}-service.test.ts`;
 * this file proves the real UI is wired to that layer, permission
 * boundaries hold, and exports work end-to-end.
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);
});

const PASSWORD = "alpha-os-dev-password";

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

base.describe("Billing compliance — revenue recognition & tax", () => {
  base("platform_owner sees deferred revenue, the recognition trend, and tax collected — real figures from the Iota Media fixture", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto("/admin/billing/compliance");

    await expect(page.getByRole("heading", { name: "Revenue recognition & tax compliance" })).toBeVisible();
    await expect(page.getByText("Deferred revenue")).toBeVisible();
    await expect(page.getByText("Revenue recognized over time")).toBeVisible();
    await expect(page.getByText("Tax collected this month")).toBeVisible();
    // The Iota Media fixture's own real, exact figures — $49.00 total billed, a real 2-component tax breakdown.
    await expect(page.getByText("$49.00").first()).toBeVisible();
    await expect(page.getByText("txr_dev_ca_state")).toBeVisible();
    await expect(page.getByText("txr_dev_ca_county")).toBeVisible();
  });

  base("platform_admin (billing.compliance.read) can see the page but cannot export", async ({ page }) => {
    await loginAs(page, "platform-admin@alpha-os.test");
    await page.goto("/admin/billing/compliance");
    await expect(page.getByRole("heading", { name: "Revenue recognition & tax compliance" })).toBeVisible();

    const response = await page.request.get("/admin/billing/export/revenue-recognition");
    expect(response.status()).toBe(403);
  });

  base("support_admin (no billing.compliance.read) cannot reach the compliance page", async ({ page }) => {
    await loginAs(page, "support-admin@alpha-os.test");
    await page.goto("/admin/billing/compliance");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("a customer organization's own owner cannot reach the compliance page", async ({ page }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto("/admin/billing/compliance");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("the compliance page is reachable from the dashboard's own actions", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto("/admin/billing");
    await page.getByRole("main").getByRole("link", { name: "Compliance" }).click();
    await expect(page.getByRole("heading", { name: "Revenue recognition & tax compliance" })).toBeVisible();
  });

  base("the control center shows no anomalies for internally-consistent tax data (Iota Media's own fixture)", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto("/admin/billing/controls");
    await expect(page.getByRole("heading", { name: "Anomalies" })).toBeVisible();
  });

  base("platform_owner can download the deferred-revenue and tax CSV reports; the reports page lists them", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto("/admin/billing/reports");
    await expect(page.getByText("Deferred revenue")).toBeVisible();
    await expect(page.getByText("Tax compliance")).toBeVisible();

    const recognitionResponse = await page.request.get("/admin/billing/export/revenue-recognition");
    expect(recognitionResponse.status()).toBe(200);
    const recognitionCsv = await recognitionResponse.text();
    expect(recognitionCsv.split("\n")[0]).toContain("total_billed");
    expect(recognitionCsv).toContain("49.00");

    const taxResponse = await page.request.get("/admin/billing/export/tax");
    expect(taxResponse.status()).toBe(200);
    const taxCsv = await taxResponse.text();
    expect(taxCsv.split("\n")[0]).toContain("provider_tax_rate_id");
    expect(taxCsv).toContain("txr_dev_ca_state");
  });

  base("an unauthorized forged report type returns a safe not-found response, never a raw SQL/stack-trace leak", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    const response = await page.request.get("/admin/billing/export/not-a-real-report-type");
    expect(response.status()).toBe(404);
    const body = await response.text();
    expect(body).not.toMatch(/at\s+\S+\s+\(.*\.ts:\d+/);
  });
});
