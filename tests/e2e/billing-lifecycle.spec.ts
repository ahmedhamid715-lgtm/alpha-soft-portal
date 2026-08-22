import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Module 14 (Billing Operations, Subscription Lifecycle & Revenue
 * Management) E2E — the NEW surfaces this module adds on top of Module
 * 13's own billing pages: the customer "change plan" preview/apply
 * control, and the platform admin credit issuance / trial extension /
 * reconciliation-check / webhooks surfaces. Same discipline as Module
 * 13's own `billing.spec.ts`/`admin-billing.spec.ts`: real browser, real
 * running app, real database, against a production build; business-rule
 * coverage lives in `tests/integration/db/*.test.ts`, this file proves
 * the UI is actually wired to it.
 *
 * No Stripe test key is configured in this dev environment (same as
 * every other billing E2E file here) — every action that reaches the
 * PROVIDER (apply a plan change, extend a trial, run a reconciliation
 * check) is asserted to fail with a SAFE error message, never a crash,
 * exactly mirroring `admin-billing.spec.ts`'s own refund test for the
 * identical reason. `issueCredit()` never calls the provider at all, so
 * that ONE action is asserted to genuinely succeed end-to-end.
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

async function starterMonthlyPriceId(): Promise<string> {
  return withPgClient((client) =>
    client
      .query("SELECT pp.id FROM plan_prices pp JOIN plans p ON p.id = pp.plan_id WHERE p.key = 'starter' AND pp.interval = 'MONTH'")
      .then((r) => r.rows[0].id as string),
  );
}

base.describe("Billing lifecycle — customer change-plan control & payment retry", () => {
  base("owner selects a plan to change to; previewing surfaces a real, safe domain error (the seed catalog's prices have no live provider price id, so this dev environment can never actually reach Stripe here) rather than a crash, and the subscription is unchanged", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    const starterPriceId = await starterMonthlyPriceId();
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/billing`);

    await expect(page.getByText("Growth", { exact: true })).toBeVisible();
    await page.getByLabel("Change plan to").selectOption(starterPriceId);
    await page.getByRole("button", { name: "Preview change" }).click();

    // `previewPlanChange()` rejects BEFORE ever calling the provider —
    // spec §26/§43: a price with no live `providerPriceId` is "not yet
    // available for purchase," the same real validation `startCheckoutFor
    // PlanPrice()` already enforces (see `billing.spec.ts`'s own use of
    // this same seeded catalog). This is still exactly the property
    // under test: an unavailable/failed preview is shown as an honest
    // error, never fabricated numbers, and never blocks the confirm step.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/not yet available for purchase/i)).toBeVisible();

    await dialog.getByRole("button", { name: "Confirm plan change" }).click();
    await expect(page.getByText(/not yet available for purchase/i)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error");

    // Nothing actually changed — rejected before any local write.
    await page.reload();
    await expect(page.getByText("Growth", { exact: true })).toBeVisible();
  });

  base("owner retries payment on Delta Consulting's seeded OPEN invoice — Stripe unconfigured surfaces a safe error, never a crash", async ({ page }) => {
    const orgCId = await orgIdBySlug("delta-consulting-dev");
    await loginAs(page, "owner-c@alpha-os.test");
    await page.goto(`/organizations/${orgCId}/billing/invoices`);
    await page.locator("table a[href*='/billing/invoices/']").first().click();

    await expect(page.getByRole("button", { name: "Retry payment" })).toBeVisible();
    await page.getByRole("button", { name: "Retry payment" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Retry payment" }).click();

    await expect(page.getByText(/Stripe/i)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error");
  });

  base("an admin (billing.read only, no billing.manage) never sees the retry-payment button on an OPEN invoice", async ({ page }) => {
    const orgCId = await orgIdBySlug("delta-consulting-dev");
    await loginAs(page, "admin-c@alpha-os.test");
    await page.goto(`/organizations/${orgCId}/billing/invoices`);
    await page.locator("table a[href*='/billing/invoices/']").first().click();
    await expect(page.getByRole("button", { name: "Retry payment" })).toHaveCount(0);
  });

  base("a member without billing.manage never sees the change-plan control at all", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "admin-a@alpha-os.test"); // billing.read only, not billing.manage
    await page.goto(`/organizations/${orgAId}/billing`);
    await expect(page.getByLabel("Change plan to")).toHaveCount(0);
  });
});

base.describe("Billing lifecycle — platform credit & trial administration", () => {
  base("platform_admin issues a real credit to Delta Consulting; the balance and activity update immediately", async ({ page }) => {
    const orgCId = await orgIdBySlug("delta-consulting-dev");
    await loginAs(page, "platform-admin@alpha-os.test");
    await page.goto(`/admin/billing/organizations/${orgCId}`);

    await expect(page.getByRole("heading", { name: "Delta Consulting" })).toBeVisible();
    const uniqueReason = `E2E credit ${Date.now()}`;
    await page.getByLabel(/Amount/).fill("12.34");
    await page.getByLabel("Reason").first().fill(uniqueReason);
    await page.getByRole("button", { name: "Issue credit" }).click();

    await expect(page.getByText("Credit issued.")).toBeVisible();
    // Scoped to THIS entry's own row — repeated runs of this spec issue
    // more $12.34 credits to the same organization (this codebase's own
    // established "E2E doesn't clean up what it creates" convention, see
    // `admin-billing.spec.ts`'s own comment), so a bare amount match
    // would resolve to multiple rows; the reason text is unique per run.
    const row = page.locator("div").filter({ hasText: uniqueReason }).last();
    await expect(row).toBeVisible();
    await expect(row.getByText("+$12.34")).toBeVisible();
  });

  base("support_admin (billing.readPlatform only, no billing.credit.manage) sees no credit-issuance form", async ({ page }) => {
    const orgCId = await orgIdBySlug("delta-consulting-dev");
    await loginAs(page, "support-admin@alpha-os.test");
    await page.goto(`/admin/billing/organizations/${orgCId}`);

    await expect(page.getByRole("heading", { name: "Delta Consulting" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Issue credit" })).toHaveCount(0);
  });

  base("trial extension is only offered while TRIALING, and (Stripe unconfigured) fails safely rather than crashing", async ({ page }) => {
    const orgBId = await orgIdBySlug("beta-industries-dev");
    await loginAs(page, "platform-admin@alpha-os.test");
    await page.goto(`/admin/billing/organizations/${orgBId}`);

    await expect(page.getByRole("heading", { name: "Beta Industries" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Extend trial" })).toBeVisible();
    await page.getByLabel("Reason").last().fill(`E2E trial extend ${Date.now()}`);
    await page.getByRole("button", { name: "Extend trial" }).click();

    await expect(page.getByText(/Stripe/i)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error");
  });

  base("trial extension is NOT offered for an ACTIVE (non-trialing) subscription", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "platform-admin@alpha-os.test");
    await page.goto(`/admin/billing/organizations/${orgAId}`);
    await expect(page.getByRole("button", { name: "Extend trial" })).toHaveCount(0);
  });
});

base.describe("Billing lifecycle — reconciliation & webhook observability", () => {
  base("reconciliation check (Stripe unconfigured) fails safely, never crashes", async ({ page }) => {
    const orgCId = await orgIdBySlug("delta-consulting-dev");
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto(`/admin/billing/organizations/${orgCId}`);

    await page.getByRole("button", { name: "Run reconciliation check" }).click();
    await expect(page.getByText(/Stripe/i)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error");
  });

  base("platform_owner sees the webhooks observability page; support_agent cannot reach it", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto("/admin/billing/webhooks");
    await expect(page.getByRole("heading", { name: "Billing webhooks" })).toBeVisible();

    await page.context().clearCookies();
    await loginAs(page, "support-agent@alpha-os.test");
    await page.goto("/admin/billing/webhooks");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });
});
