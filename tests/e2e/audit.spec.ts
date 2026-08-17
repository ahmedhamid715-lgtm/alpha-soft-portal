import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Module 08 (Audit & Compliance) E2E — real browser, real running app,
 * real database, no mocked authorization. Uses the same seeded fixtures
 * as `user-org-management.spec.ts` (Org A "Acme Corp", Org B "Beta
 * Industries", platform staff). Deliberately prefers accounts that
 * spec's own suite uses less (owner-b/admin-b/customer-b/platform-owner)
 * to stay well under `authRateLimiter`'s 10-logins-per-15-minutes-per-
 * email budget when this file runs in the same session as the rest of
 * the E2E suite.
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

async function orgId(slug: string): Promise<string> {
  return withPgClient((client) => client.query("SELECT id FROM organizations WHERE slug = $1", [slug]).then((r) => r.rows[0].id as string));
}

/**
 * `auth.login.success` is recorded with `organizationId: NULL`
 * (pre-tenant, by design — see audit-system.md) so it never appears in
 * an ORGANIZATION-scoped audit log, only the platform one. Tests below
 * that need a real, deterministic, ORG-scoped event seed one directly —
 * the same `withPgClient` direct-insert technique
 * `user-org-management-accessibility.spec.ts` already uses for fixture
 * setup, not a second application under test.
 */
async function seedOrgAuditEvent(organizationId: string, action: string): Promise<string> {
  return withPgClient(async (client) => {
    const result = await client.query(
      `INSERT INTO audit_events (id, organization_id, actor_type, action, category, outcome, resource_type, resource_id, resource_name, request_id, correlation_id, created_at)
       VALUES (gen_random_uuid(), $1, 'SYSTEM', $2, 'ORGANIZATION', 'SUCCESS', 'organization', $1, 'E2E Fixture Resource', gen_random_uuid()::text, gen_random_uuid()::text, now())
       RETURNING id`,
      [organizationId, action],
    );
    return result.rows[0].id as string;
  });
}

async function deleteAuditEvent(id: string): Promise<void> {
  await withPgClient((client) => client.query("DELETE FROM audit_events WHERE id = $1", [id]));
}

base.describe("Platform audit log", () => {
  base("platform_owner can view, filter, and export the platform audit log", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");

    await page.goto("/admin/audit");
    await expect(page.locator("body")).not.toContainText("don't have access");
    await expect(page.locator("table")).toBeVisible();

    // Filter by outcome — the URL becomes the query, no client state.
    await page.selectOption("#audit-outcome", "SUCCESS");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("outcome=SUCCESS");

    // Detail page: human-readable description shown, not raw JSON as the whole UI.
    const firstRow = page.locator("table tbody tr").first();
    await firstRow.locator("a").first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("What happened")).toBeVisible();

    // Export downloads a real file.
    await page.goto("/admin/audit");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Export CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^audit-log-platform-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

base.describe("Organization audit log", () => {
  base("an org owner can view their own organization's audit log, open an event's detail page, and export it — all in one session", async ({ page }) => {
    const id = await orgId("beta-industries-dev");
    const eventId = await seedOrgAuditEvent(id, "organization.updated");

    try {
      await loginAs(page, "owner-b@alpha-os.test");

      await page.goto(`/organizations/${id}/audit`);
      await expect(page.locator("body")).not.toContainText("don't have access");
      await expect(page.locator("table")).toBeVisible();
      await expect(page.locator("table")).toContainText("organization.updated");
      await expect(page.locator("table")).toContainText("E2E Fixture Resource");

      // Detail page + investigation navigation, in the same session.
      const row = page.locator("table tbody tr", { hasText: "organization.updated" }).first();
      await row.locator("a").first().click();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("What happened")).toBeVisible();
      const resourceLink = page.getByRole("link", { name: /All events for this organization →/ });
      await expect(resourceLink).toBeVisible();
      // `waitForURL`, not `waitForLoadState("networkidle")` — this is a
      // Next.js client-side `<Link>` transition, which doesn't
      // necessarily flip the browser's native loading state the way a
      // full navigation does; `networkidle` can resolve before the URL
      // actually updates, racing the assertion below. Found by running
      // this test for real, not by inspection.
      await Promise.all([page.waitForURL(/resourceId=/), resourceLink.click()]);
      expect(page.url()).toContain("resourceId=");
      await expect(page.locator("body")).toContainText("Filtered by investigation link");

      // Export.
      await page.goto(`/organizations/${id}/audit`);
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("link", { name: "Export CSV" }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(new RegExp(`^audit-log-${id}-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
    } finally {
      await deleteAuditEvent(eventId);
    }
  });

  base("a customer-role member sees an access-denied message, not the audit table", async ({ page }) => {
    await loginAs(page, "customer-b@alpha-os.test");
    const id = await orgId("beta-industries-dev");

    await page.goto(`/organizations/${id}/audit`);
    await expect(page.locator("body")).toContainText("don't have access");
    await expect(page.locator("table")).toHaveCount(0);
  });
});
