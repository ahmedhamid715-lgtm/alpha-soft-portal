import { test as base, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * axe-core against Module 15's new billing-intelligence surfaces — the
 * financial dashboard (metric tiles, movement, revenue, aging, at-risk
 * table, MRR trend chart + its accessible table equivalent), the
 * organizations directory, the control center, the reports/export page,
 * the extended organization-detail sections (financial health/MRR/
 * aging), and the extended customer billing page (outstanding balance +
 * export section). Same documented scope (desktop only × light/dark) as
 * `billing-accessibility.spec.ts` / `billing-lifecycle-accessibility.spec.ts`.
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
 * Same as `scan()`, minus axe's "region" rule — for scans taken while a
 * `MetricInfo` tooltip is open. Same well-documented Radix+axe
 * interaction as `user-org-management-accessibility.spec.ts`'s own
 * `scanPopup()`: `TooltipContent` renders through a Portal directly
 * under `<body>`, outside `<main>`, deliberately — it's transient
 * floating content (`role="tooltip"`, wired to its trigger via
 * `aria-describedby`), not page content that needs landmark
 * containment. "region" is best-practice only (no `wcag2a`/`wcag2aa`
 * tag) — page-load scans (no popup open) keep the full default rule
 * set, where "region" is a legitimate check.
 */
async function scanPopup(page: Page, label: string, violations: string[]) {
  const results = await new AxeBuilder({ page }).disableRules(["region"]).analyze();
  if (results.violations.length > 0) {
    violations.push(`${label}: ${JSON.stringify(results.violations, null, 2)}`);
  }
}

base.describe("Billing intelligence accessibility (Module 15)", () => {
  base("platform financial dashboard, incl. MRR trend chart's accessible table + an open metric-info tooltip: zero axe violations, light + dark", async ({ page }) => {
    const violations: string[] = [];
    await loginAs(page, "platform-owner@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/admin/billing");
      await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
      await scan(page, `financial dashboard (${scheme})`, violations);

      await page.emulateMedia({ colorScheme: scheme });
      await page.getByLabel("What does this metric mean?").first().focus();
      await expect(page.getByText(/Monthly Recurring Revenue/)).toBeVisible();
      await scanPopup(page, `financial dashboard, metric-info tooltip open (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("billing organizations directory: zero axe violations, light + dark", async ({ page }) => {
    const violations: string[] = [];
    await loginAs(page, "platform-owner@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/admin/billing/organizations");
      await expect(page.getByRole("heading", { name: "Billing organizations" })).toBeVisible();
      await scan(page, `organizations directory (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("billing control center, incl. anomalies table: zero axe violations, light + dark", async ({ page }) => {
    const violations: string[] = [];
    await loginAs(page, "platform-owner@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/admin/billing/controls");
      await expect(page.getByRole("heading", { name: "Billing controls" })).toBeVisible();
      await scan(page, `control center (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("billing reports/export page: zero axe violations, light + dark", async ({ page }) => {
    const violations: string[] = [];
    await loginAs(page, "platform-owner@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/admin/billing/reports");
      await expect(page.getByRole("heading", { name: "Billing reports" })).toBeVisible();
      await scan(page, `reports page (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("admin org detail, extended with financial health + MRR + aging (Delta Consulting, AT_RISK/CRITICAL): zero axe violations, light + dark", async ({ page }) => {
    const orgCId = await orgIdBySlug("delta-consulting-dev");
    const violations: string[] = [];
    await loginAs(page, "platform-owner@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/admin/billing/organizations/${orgCId}`);
      await expect(page.getByText("Financial health")).toBeVisible();
      await scan(page, `admin org detail, financial health/MRR/aging (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("customer billing page, extended with outstanding balance + export section (Delta Consulting owner): zero axe violations, light + dark", async ({ page }) => {
    const orgCId = await orgIdBySlug("delta-consulting-dev");
    const violations: string[] = [];
    await loginAs(page, "owner-c@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/organizations/${orgCId}/billing`);
      await expect(page.getByText("Export your data")).toBeVisible();
      await scan(page, `customer billing page, outstanding balance + export (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });
});
