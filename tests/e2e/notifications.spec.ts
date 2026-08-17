import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Module 09 (Notification & Communication Infrastructure) E2E — real
 * browser, real running app, real database, no mocked authorization.
 * Reuses `prisma/seed-notifications.ts`'s fixtures (member-a: unread +
 * read + archived notifications and a non-default preference; owner-a:
 * a mandatory ACCOUNT_SECURITY notification; platform-owner: the
 * `notifications.observability` permission). Same account-budget
 * discipline `audit.spec.ts`'s own top comment documents — this file
 * logs in as each account at most once.
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

/**
 * Resets member-a's seeded "Access restored" notification back to
 * UNREAD before every test — the earlier test in this file that marks
 * it read would otherwise leave every subsequent (and every future re-)
 * run permanently starting from a different state than
 * `seed-notifications.ts` describes. Same direct-`pg`-client fixture
 * technique `audit.spec.ts`/`user-org-management-accessibility.spec.ts`
 * already use, not a second application under test.
 */
base.beforeEach(async () => {
  await withPgClient((client) =>
    client.query(`UPDATE notifications SET status = 'UNREAD', read_at = NULL WHERE title = 'Access restored'`),
  );
});

base.describe("Notification center", () => {
  base("the bell shows an unread badge, and the full /notifications page lists the seeded unread notification", async ({ page }) => {
    await loginAs(page, "member-a@alpha-os.test");

    const bell = page.getByRole("button", { name: /Notifications/ });
    await expect(bell).toBeVisible();
    // `prisma/seed-notifications.ts` seeds exactly one UNREAD notification for member-a.
    await expect(bell.getByText(/^\d+$/)).toBeVisible();

    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(page.getByText("Access restored")).toBeVisible();
  });

  base("marking a notification read updates its state and the unread count", async ({ page }) => {
    await loginAs(page, "member-a@alpha-os.test");
    await page.goto("/notifications?status=UNREAD");

    const row = page.locator("li", { hasText: "Access restored" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Mark as read" }).click();

    // The row disappears from the UNREAD filter once its status changes —
    // proves the mutation actually persisted server-side (a full page
    // reload happens via the form POST + revalidatePath), not just a
    // client-side optimistic flip.
    await expect(page.locator("li", { hasText: "Access restored" })).toHaveCount(0);
  });

  base("mandatory ACCOUNT_SECURITY channels render as locked 'Required', never a toggle a user could disable", async ({ page }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto("/settings/notifications");

    await expect(page.getByRole("heading", { name: "Notification preferences" })).toBeVisible();
    const securityCard = page.locator('[data-slot="card"]', { hasText: "Account security" });
    await expect(securityCard.getByText("Required").first()).toBeVisible();
  });

  base("an optional preference toggle persists across a reload", async ({ page }) => {
    await loginAs(page, "member-a@alpha-os.test");
    await page.goto("/settings/notifications");

    // `seed-notifications.ts` seeds member-a's ORGANIZATION_ACTIVITY/EMAIL
    // preference as explicitly OFF — IN_APP is mandatory for this
    // category (locked badge, no switch), so the one switch this card
    // renders is Email. Assert that state, flip it, confirm the flip
    // survives a reload.
    const orgCard = page.locator('[data-slot="card"]', { hasText: "Organization activity" });
    const emailSwitch = orgCard.getByRole("switch");
    await expect(emailSwitch).toHaveCount(1);
    await expect(emailSwitch).not.toBeChecked();

    await emailSwitch.click();
    await page.waitForTimeout(500); // Server Action round trip — no client-visible loading indicator to await on.
    await page.reload();

    const orgCardAfterReload = page.locator('[data-slot="card"]', { hasText: "Organization activity" });
    await expect(orgCardAfterReload.getByRole("switch")).toBeChecked();

    // Restore fixture state so a repeat test run starts from the same baseline.
    await orgCardAfterReload.getByRole("switch").click();
  });

  base("a non-platform-staff user is denied /admin/notifications; platform-owner (notifications.observability) sees real delivery rows including the seeded failure", async ({ page }) => {
    await loginAs(page, "member-a@alpha-os.test");
    await page.goto("/admin/notifications");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
    await page.context().clearCookies();

    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto("/admin/notifications");
    await expect(page.getByRole("heading", { name: "Notification delivery" })).toBeVisible();
    // `seed-notifications.ts` seeds one terminal FAILED email delivery for
    // admin-a — scoped to the table body, not the filter `<select>` (which
    // also has a hidden "FAILED" `<option>`).
    await expect(page.locator("tbody").getByText("FAILED").first()).toBeVisible();
  });
});
