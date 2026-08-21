import { test as base, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * axe-core against Module 12's new UI — the Security section on
 * `/organizations/[id]/settings`, both the owner's editable form and the
 * admin's read-only rendering. Desktop only × light/dark — same
 * documented scope reduction Module 10/11's own accessibility specs
 * already established.
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

async function resetInvitationPolicy(organizationId: string): Promise<void> {
  await withPgClient((client) => client.query("DELETE FROM organization_invitation_policies WHERE organization_id = $1", [organizationId]));
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

base.describe("Organization security accessibility", () => {
  base("owner's editable Security form and admin's read-only Security section: zero axe violations, light + dark", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await resetInvitationPolicy(orgAId);
    const violations: string[] = [];

    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/settings`);
    await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await scan(page, `owner settings (${scheme})`, violations);
    }

    await loginAs(page, "admin-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/settings`);
    await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await scan(page, `admin settings, read-only (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
    await resetInvitationPolicy(orgAId);
  });
});
