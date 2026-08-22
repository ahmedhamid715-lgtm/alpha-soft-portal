import { test as base, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * axe-core against Module 14's NEW billing surfaces — the customer
 * change-plan control (dropdown + confirm dialog), and the platform
 * admin credit-issuance form, trial-extension form, reconciliation
 * result, and webhooks observability page. Same documented scope
 * (desktop only × light/dark) and same `waitForDialogSettled()`
 * discipline `billing-accessibility.spec.ts` already established — see
 * that file's own comment for why a dialog scan can't run immediately
 * after `toBeVisible()`.
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);
});

const SCHEMES = ["light", "dark"] as const;
const PASSWORD = "alpha-os-dev-password";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://ahmed@localhost:5432/alpha_os_dev";

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

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

async function scan(page: Page, label: string, violations: string[]) {
  const results = await new AxeBuilder({ page }).analyze();
  if (results.violations.length > 0) {
    violations.push(`${label}: ${JSON.stringify(results.violations, null, 2)}`);
  }
}

async function waitForDialogSettled(page: Page): Promise<void> {
  await page.getByRole("dialog").waitFor({ state: "visible" });
  await page.waitForTimeout(250);
}

base.describe("Billing lifecycle accessibility (Module 14)", () => {
  base("customer change-plan control + confirm dialog: zero axe violations, light + dark", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    const starterPriceId = await starterMonthlyPriceId();
    const violations: string[] = [];

    await loginAs(page, "owner-a@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/organizations/${orgAId}/billing`);
      await expect(page.getByLabel("Change plan to")).toBeVisible();
      await scan(page, `change-plan control, closed (${scheme})`, violations);

      await page.emulateMedia({ colorScheme: scheme });
      await page.getByLabel("Change plan to").selectOption(starterPriceId);
      await page.getByRole("button", { name: "Preview change" }).click();
      await waitForDialogSettled(page);
      await scan(page, `change-plan confirm dialog (${scheme})`, violations);
      await page.keyboard.press("Escape");
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("invoice detail with the retry-payment button + confirm dialog: zero axe violations, light + dark", async ({ page }) => {
    const orgCId = await orgIdBySlug("delta-consulting-dev");
    const violations: string[] = [];
    await loginAs(page, "owner-c@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/organizations/${orgCId}/billing/invoices`);
      await page.locator("table a[href*='/billing/invoices/']").first().click();
      await expect(page.getByRole("button", { name: "Retry payment" })).toBeVisible();
      await scan(page, `invoice detail, retry button (${scheme})`, violations);

      await page.emulateMedia({ colorScheme: scheme });
      await page.getByRole("button", { name: "Retry payment" }).click();
      await waitForDialogSettled(page);
      await scan(page, `retry-payment confirm dialog (${scheme})`, violations);
      await page.keyboard.press("Escape");
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("admin org billing detail with credit-issuance and reconciliation sections: zero axe violations, light + dark", async ({ page }) => {
    const orgCId = await orgIdBySlug("delta-consulting-dev");
    const violations: string[] = [];
    await loginAs(page, "platform-admin@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/admin/billing/organizations/${orgCId}`);
      await expect(page.getByRole("button", { name: "Issue credit" })).toBeVisible();
      await scan(page, `admin org detail, credit + reconciliation (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("admin org billing detail with the trial-extension form (TRIALING organization): zero axe violations, light + dark", async ({ page }) => {
    const orgBId = await orgIdBySlug("beta-industries-dev");
    const violations: string[] = [];
    await loginAs(page, "platform-admin@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/admin/billing/organizations/${orgBId}`);
      await expect(page.getByRole("button", { name: "Extend trial" })).toBeVisible();
      await scan(page, `admin org detail, trial extension (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("reconciliation result alert (divergence-detected style, safe-error state here): zero axe violations, light + dark", async ({ page }) => {
    const orgCId = await orgIdBySlug("delta-consulting-dev");
    const violations: string[] = [];
    await loginAs(page, "platform-owner@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/admin/billing/organizations/${orgCId}`);
      await page.getByRole("button", { name: "Run reconciliation check" }).click();
      await expect(page.getByText(/Stripe/i)).toBeVisible();
      await scan(page, `reconciliation result (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("billing webhooks observability page: zero axe violations, light + dark", async ({ page }) => {
    const violations: string[] = [];
    await loginAs(page, "platform-owner@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/admin/billing/webhooks");
      await expect(page.getByRole("heading", { name: "Billing webhooks" })).toBeVisible();
      await scan(page, `billing webhooks (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });
});
