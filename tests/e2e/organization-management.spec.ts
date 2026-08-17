import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Module 11 (Organization Management) E2E — real browser, real running
 * app, real database, against a production build. Same account-budget
 * discipline every other E2E spec in this project follows. Business-rule
 * coverage (state-machine guards, cross-tenant IDOR, concurrency,
 * notification fan-out) is already proven at the database layer in
 * `tests/integration/db/organization-management-service.test.ts`; this
 * file's job is proving the new UI is wired to the real, permission-
 * gated service layer — most importantly, the actual reactivation
 * regression this module's own testing found and fixed.
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

async function setOrgStatus(id: string, status: "ACTIVE" | "SUSPENDED" | "ARCHIVED"): Promise<void> {
  await withPgClient((client) => client.query("UPDATE organizations SET status = $2 WHERE id = $1", [id, status]));
}

base.describe("Organization management (platform)", () => {
  base("a non-platform-staff user is denied /admin/organizations", async ({ page }) => {
    await loginAs(page, "viewer-a@alpha-os.test");
    await page.goto("/admin/organizations");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("support-agent (organizations.read) sees the directory and can open a suspended organization's platform profile", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");

    await page.goto("/admin/organizations?status=SUSPENDED");
    await expect(page.getByRole("heading", { name: "Organizations" })).toBeVisible();
    await expect(page.getByText("Suspended Org")).toBeVisible();

    await page.locator("table a[href^='/admin/organizations/']").first().click();
    await expect(page.getByRole("heading", { name: "Suspended Org" })).toBeVisible();
    // support_admin/support_agent hold organizations.read but never
    // organizations.reactivate (see roles.ts) — no reactivate button.
    await expect(page.getByRole("button", { name: "Reactivate organization" })).toHaveCount(0);
  });

  base("the real regression: platform-owner reactivates a suspended organization they are NOT a member of, via /admin/organizations/[id] — /organizations/[id]/settings itself denies them (the bug this module fixed)", async ({ page }) => {
    const orgId = await orgIdBySlug("suspended-org-dev");
    // This spec's own precondition — a previous run elsewhere in the
    // suite may have left this fixture reactivated; set it explicitly
    // rather than trusting shared state (the exact flakiness this
    // avoids).
    await setOrgStatus(orgId, "SUSPENDED");
    try {
      await loginAs(page, "platform-owner@alpha-os.test");

      // The bug: the self-service settings page 404s/denies platform
      // staff with no membership in this specific organization, even
      // though they hold organizations.reactivate via their PLATFORM
      // context.
      await page.goto(`/organizations/${orgId}/settings`);
      await expect(page.getByText("You don't have access to this page")).toBeVisible();

      // The fix: /admin/organizations/[id] is the reachable path.
      await page.goto(`/admin/organizations/${orgId}`);
      await expect(page.getByText("SUSPENDED").first()).toBeVisible();
      await page.getByRole("button", { name: "Reactivate organization" }).click();
      await page.getByRole("button", { name: "Reactivate" }).last().click();
      await expect(page.getByText("ACTIVE").first()).toBeVisible();
    } finally {
      await setOrgStatus(orgId, "SUSPENDED"); // restore the shared dev fixture's own expected state
    }
  });

  base("an archived organization cannot be reactivated — archival is terminal", async ({ page }) => {
    const orgId = await orgIdBySlug("archived-org-dev");
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto(`/admin/organizations/${orgId}`);
    await expect(page.getByText("ARCHIVED").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Reactivate organization" })).toHaveCount(0);
    await expect(page.getByText(/archival is terminal/i)).toBeVisible();
  });
});
