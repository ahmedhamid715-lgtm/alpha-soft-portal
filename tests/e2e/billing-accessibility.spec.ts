import { test as base, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * axe-core against Module 13's billing surfaces — customer billing
 * dashboard (owner, editable, and admin, read-only), invoice list,
 * invoice detail, platform billing directory + org detail (with the
 * refund confirm dialog open), and the plan catalog admin page. Desktop
 * only × light/dark — same documented scope reduction every prior
 * module's own accessibility spec already established.
 *
 * `page.emulateMedia({ colorScheme })` is re-applied before EVERY
 * `page.goto()`/interaction, not just once per test — same discipline
 * `organization-management-accessibility.spec.ts` already established
 * (its own comment: a scheme set once does not reliably survive
 * multiple subsequent navigations within the same test — found the hard
 * way by this module's own first attempt at this file, which only set
 * it once per test and silently kept scanning in whatever scheme the
 * PAGE ITSELF happened to still be in, not the one the test believed it
 * was scanning).
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

/**
 * Radix's Dialog fades/zooms in over `duration-100` (100ms —
 * `dialog.tsx`'s own `DialogContent` class). `toBeVisible()` only
 * requires non-zero size/visibility, not "animation finished" — an axe
 * scan that races the tail of that transition captures a genuinely
 * transient, still-blending color (opacity mid-fade composites toward
 * the backdrop), which axe correctly flags as failing contrast even
 * though the SETTLED state is fine. Found by this module's own testing
 * — two apparent contrast failures here initially looked like real
 * component bugs (and one, a missing `--color-destructive-foreground`
 * theme-token registration, genuinely was — see globals.css's own
 * comment) — direct DOM inspection of the settled state was the only
 * way to tell the transient artifact apart from the real bug.
 */
async function waitForDialogSettled(page: Page): Promise<void> {
  await page.getByRole("dialog").waitFor({ state: "visible" });
  await page.waitForTimeout(250);
}

base.describe("Billing accessibility", () => {
  base("customer billing dashboard + cancel dialog: zero axe violations, light + dark", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    const violations: string[] = [];

    await loginAs(page, "owner-a@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/organizations/${orgAId}/billing`);
      await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
      await scan(page, `owner billing dashboard (${scheme})`, violations);

      await page.getByRole("button", { name: "Cancel subscription" }).click();
      await waitForDialogSettled(page);
      await scan(page, `cancel confirm dialog (${scheme})`, violations);
      await page.keyboard.press("Escape");
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("invoice list + detail: zero axe violations, light + dark", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    const violations: string[] = [];

    await loginAs(page, "owner-a@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/organizations/${orgAId}/billing/invoices`);
      await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
      await scan(page, `invoice list (${scheme})`, violations);

      await page.emulateMedia({ colorScheme: scheme });
      const invoiceLink = page.locator("table a[href*='/billing/invoices/']").first();
      await invoiceLink.click();
      await expect(page.getByRole("heading", { name: "Line items" })).toBeVisible();
      await scan(page, `invoice detail (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("admin (billing.read only) sees the read-only billing dashboard: zero axe violations", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    const violations: string[] = [];

    await loginAs(page, "admin-a@alpha-os.test");
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/organizations/${orgAId}/billing`);
      await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
      await scan(page, `admin billing dashboard, read-only (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("platform billing directory: zero axe violations, light + dark", async ({ page }) => {
    const violations: string[] = [];
    await loginAs(page, "platform-owner@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/admin/billing/organizations");
      await expect(page.getByRole("heading", { name: "Billing organizations" })).toBeVisible();
      await scan(page, `platform billing directory (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("platform org billing detail + refund confirm dialog: zero axe violations, light + dark", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    const violations: string[] = [];
    await loginAs(page, "platform-owner@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/admin/billing/organizations/${orgAId}`);
      await expect(page.getByRole("heading", { name: "Acme Corp" })).toBeVisible();
      await scan(page, `platform org billing detail (${scheme})`, violations);

      await page.emulateMedia({ colorScheme: scheme });
      await page.getByRole("button", { name: "Refund" }).first().click();
      await waitForDialogSettled(page);
      await scan(page, `refund confirm dialog (${scheme})`, violations);
      await page.keyboard.press("Escape");
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("plan catalog admin: zero axe violations, light + dark", async ({ page }) => {
    const violations: string[] = [];
    await loginAs(page, "platform-admin@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/admin/plans");
      await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible();
      await scan(page, `plan catalog admin (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });
});
