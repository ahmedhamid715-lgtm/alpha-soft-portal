import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Module 10 (User Management) E2E — real browser, real running app, real
 * database. Same account-budget discipline `audit.spec.ts`/
 * `notifications.spec.ts` already document — logs in with each account
 * at most once. Business-rule coverage (last-owner protection, IDOR,
 * concurrency) is already proven at the database layer in
 * `tests/integration/db/user-management-service.test.ts`; this file's
 * job is proving the UI is wired to the real, permission-gated service
 * layer, not re-proving the rules themselves.
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

/** A throwaway user, created and destroyed per-test directly in the database — avoids depending on `createPlatformUser()`'s own email side effect for a UI test that only needs a target row to click "Suspend" on. */
async function createThrowawayUser(name: string): Promise<{ id: string; email: string }> {
  return withPgClient(async (client) => {
    const email = `e2e-um-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const result = await client.query(
      `INSERT INTO users (id, email, name, status, email_verified_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', now(), now(), now())
       RETURNING id`,
      [email, name],
    );
    return { id: result.rows[0].id as string, email };
  });
}

async function deleteUser(id: string): Promise<void> {
  await withPgClient((client) => client.query("DELETE FROM users WHERE id = $1", [id]));
}

base.describe("User management", () => {
  base("a non-platform-staff user is denied /admin/users", async ({ page }) => {
    await loginAs(page, "viewer-a@alpha-os.test");
    await page.goto("/admin/users");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("support-agent (users.read only) sees the directory and a user's detail page, but no create/lifecycle controls", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");

    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Create platform user/ })).toHaveCount(0);

    await page.goto("/admin/users?search=member-a%40alpha-os.test");
    await page.locator("table a[href^='/admin/users/']").first().click();
    await expect(page.getByRole("heading", { name: "Member A (Dev)" })).toBeVisible();
    // Read-only: the name field is disabled, and no suspend/deactivate button renders at all.
    await expect(page.getByLabel("Name")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Suspend account" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Deactivate account" })).toHaveCount(0);
  });

  base("platform-admin can suspend and reactivate another user from the detail page; self-suspend is never offered", async ({ page }) => {
    const target = await createThrowawayUser("E2E Suspend Target");
    try {
      await loginAs(page, "platform-admin@alpha-os.test");

      await page.goto(`/admin/users/${target.id}`);
      await expect(page.getByRole("heading", { name: "E2E Suspend Target" })).toBeVisible();

      await page.getByRole("button", { name: "Suspend account" }).click();
      await page.getByRole("button", { name: "Suspend account" }).last().click(); // ConfirmDialog's own confirm button
      await expect(page.getByText("SUSPENDED").first()).toBeVisible();

      await page.getByRole("button", { name: "Reactivate account" }).click();
      await expect(page.getByText("ACTIVE").first()).toBeVisible();

      // Self-view: platform-admin's own detail page never offers to suspend/deactivate itself.
      await page.goto("/admin/users");
      await page.fill("#user-search", "platform-admin@alpha-os.test");
      await page.click("button:has-text('Filter')");
      await page.locator("table a[href^='/admin/users/']").first().click();
      await expect(page.getByText(/can.t suspend or deactivate your own account/i)).toBeVisible();
      await expect(page.getByRole("button", { name: "Suspend account" })).toHaveCount(0);
    } finally {
      await deleteUser(target.id);
    }
  });
});
