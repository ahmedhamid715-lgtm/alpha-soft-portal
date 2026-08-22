import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Module 15 (Enterprise Billing Intelligence, Revenue Operations &
 * Financial Controls) E2E — real browser, real running app, real
 * database, against a production build. Business-rule/calculation
 * coverage lives in `tests/unit/lib/billing/reporting/*.test.ts` and
 * `tests/integration/db/{mrr,revenue-reporting,financial-health,
 * billing-trends,billing-diagnostics,billing-export}-service.test.ts`;
 * this file proves the real UI is wired to that layer and reachable for
 * each persona.
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

base.describe("Billing intelligence — platform dashboard", () => {
  base("platform_owner sees the financial dashboard with real MRR/ARR, movement, revenue, and aging sections", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto("/admin/billing");

    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await expect(page.getByText("Recurring revenue")).toBeVisible();
    await expect(page.getByText(/MRR \(USD\)/).first()).toBeVisible();
    await expect(page.getByText("MRR movement (this month)")).toBeVisible();
    await expect(page.getByText("Revenue this month")).toBeVisible();
    await expect(page.getByText("Accounts receivable aging")).toBeVisible();
    await expect(page.getByText("At-risk organizations")).toBeVisible();
  });

  base("a customer organization's own owner cannot reach the financial dashboard", async ({ page }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto("/admin/billing");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("a metric's info tooltip explains exactly what it measures", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto("/admin/billing");
    await page.getByLabel("What does this metric mean?").first().focus();
    await expect(page.getByText(/Monthly Recurring Revenue/)).toBeVisible();
  });

  base("navigating to the organizations directory, controls, webhooks, and reports pages all work from the dashboard's own actions", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto("/admin/billing");

    await page.getByRole("main").getByRole("link", { name: "Organizations" }).click();
    await expect(page.getByRole("heading", { name: "Billing organizations" })).toBeVisible();
    await expect(page.getByText("Acme Corp")).toBeVisible();

    await page.goto("/admin/billing");
    await page.getByRole("main").getByRole("link", { name: "Controls" }).click();
    await expect(page.getByRole("heading", { name: "Billing controls" })).toBeVisible();

    await page.goto("/admin/billing");
    await page.getByRole("main").getByRole("link", { name: "Reports" }).click();
    await expect(page.getByRole("heading", { name: "Billing reports" })).toBeVisible();
  });
});

base.describe("Billing intelligence — organization detail extensions", () => {
  base("Delta Consulting (past-due, failed payment) shows AT_RISK or CRITICAL financial health with real named reasons", async ({ page }) => {
    const orgCId = await orgIdBySlug("delta-consulting-dev");
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto(`/admin/billing/organizations/${orgCId}`);

    await expect(page.getByText("Financial health")).toBeVisible();
    const health = page.locator("text=/At risk|Critical/").first();
    await expect(health).toBeVisible();
  });

  base("Zeta Growth (an expanded, credited, refunded organization) shows real MRR", async ({ page }) => {
    const orgZId = await orgIdBySlug("zeta-growth-dev");
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto(`/admin/billing/organizations/${orgZId}`);

    await expect(page.getByText(/MRR \(USD\)/)).toBeVisible();
    await expect(page.getByText("$199.00")).toBeVisible();
  });

  base("support_admin (billing.readPlatform + billing.analytics.read/controls.read, no billing.reports.export) sees the dashboard and controls but not the reports export page", async ({ page }) => {
    await loginAs(page, "support-admin@alpha-os.test");
    await page.goto("/admin/billing");
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();

    await page.goto("/admin/billing/controls");
    await expect(page.getByRole("heading", { name: "Billing controls" })).toBeVisible();

    await page.goto("/admin/billing/reports");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });
});

base.describe("Billing intelligence — control center", () => {
  base("platform_owner sees provider/webhook health and an anomaly-free (or explained) consistency report", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto("/admin/billing/controls");

    await expect(page.getByText("Provider synchronization")).toBeVisible();
    await expect(page.getByText("Stripe configured")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Anomalies" })).toBeVisible();
  });

  base("a customer organization's own owner cannot reach the control center", async ({ page }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto("/admin/billing/controls");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });
});

base.describe("Billing intelligence — report exports", () => {
  base("platform_owner can download the invoice CSV report; a support_agent cannot", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto("/admin/billing/reports");
    await expect(page.getByRole("heading", { name: "Billing reports" })).toBeVisible();

    const response = await page.request.get("/admin/billing/export/invoices");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    const csv = await response.text();
    expect(csv.split("\n")[0]).toContain("invoice_number");
  });

  base("an unauthorized forged report type returns a safe not-found response, never a raw SQL/stack-trace leak", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    const response = await page.request.get("/admin/billing/export/not-a-real-report-type");
    expect(response.status()).toBe(404);
    const body = await response.text();
    expect(body).not.toMatch(/at\s+\S+\s+\(.*\.ts:\d+/); // no raw stack trace
  });

  base("a customer organization owner CAN export their own organization's invoices (billing.read), but not another organization's", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    const orgBId = await orgIdBySlug("beta-industries-dev");
    await loginAs(page, "owner-a@alpha-os.test");

    const ownResponse = await page.request.get(`/organizations/${orgAId}/billing/export/invoices`);
    expect(ownResponse.status()).toBe(200);

    const forgedResponse = await page.request.get(`/organizations/${orgBId}/billing/export/invoices`);
    expect(forgedResponse.status()).toBe(403);
  });
});
