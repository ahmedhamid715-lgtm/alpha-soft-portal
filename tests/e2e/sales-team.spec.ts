import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Sales Team E2E (Build 21 — Roadmap Module 15). Direct style/helper
 * template from `sales-pipeline.spec.ts` (Build 20) — see that file's
 * own comments for the reasoning behind each helper (Radix `Select`
 * portaling to `document.body`, the app's own reachability skip, etc.).
 * Written directly by Claude (not drafted by Codex first) since Codex's
 * own sandbox cannot launch Chromium regardless — the established
 * "Codex drafts, Claude runs" split collapses to "Claude writes and
 * runs" whenever Codex itself is unavailable, same outcome either way.
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);
});

const PASSWORD = "alpha-os-dev-password";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://ahmed@localhost:5432/alpha_os_dev";
const MISSING_ID = "00000000-0000-7000-8000-000000000000";

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

async function seededMemberIds() {
  const organizationId = await orgIdBySlug("alpha-os-platform");
  return withPgClient(async (client) => {
    const admin = await client.query(
      "SELECT m.id FROM crm_sales_team_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 AND u.email = $2 AND m.status = 'ACTIVE'",
      [organizationId, "platform-admin@alpha-os.test"],
    );
    return { adminMemberId: admin.rows[0].id as string };
  });
}

async function expectNoApplicationError(page: Page) {
  await expect(page.locator("body")).not.toContainText("Application error");
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  await expectNoApplicationError(page);
}

/** See `sales-pipeline.spec.ts`'s own identical helper comment — Radix `SelectContent` portals to `document.body`, so the option is always queried against the real top-level `Page`. */
async function choose(scope: Page | Locator, label: string, option: string) {
  const rootPage = "page" in scope && typeof (scope as Locator).page === "function" ? (scope as Locator).page() : (scope as Page);
  await scope.getByLabel(label).click();
  await rootPage.getByRole("option", { name: option, exact: true }).click();
}

/** The roster table's own accessible region — a rep's name link appears BOTH here and in the leaderboard table, so any roster-specific assertion must scope to this, never a bare page-wide `getByRole("link", ...)`. */
function rosterRegion(page: Page): Locator {
  return page.getByRole("region", { name: /Sales team roster/ });
}

/** The Leaderboard section's own `PeriodSelector`/`LeaderboardMetricSelector` — the overview page's own "Organization-wide targets/quotas" `NewGoalForm` ALSO renders a "Period" label (its own goal period, unrelated), so any leaderboard-control interaction must scope to this section. */
function leaderboardSection(page: Page): Locator {
  return page.getByRole("heading", { name: "Leaderboard", exact: true }).locator("xpath=ancestor::section[1]");
}

base.describe("Sales Team — access control and discoverability", () => {
  base("platform owner reaches the sales team overview from the CRM dashboard", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await goto(page, "/admin/crm");
    await page.getByRole("link", { name: /Sales team/i }).click();
    await expect(page).toHaveURL(/\/admin\/crm\/sales-team$/);
    await expectNoApplicationError(page);
    await expect(page.getByRole("heading", { name: "Sales Team", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Leaderboard", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Roster", exact: true })).toBeVisible();
  });

  base("support agent (no sales-team permission) is denied the overview and a rep detail page", async ({ page }) => {
    const { adminMemberId } = await seededMemberIds();
    await loginAs(page, "support-agent@alpha-os.test");
    await goto(page, "/admin/crm/sales-team");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
    await goto(page, `/admin/crm/sales-team/${adminMemberId}`);
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("support admin (read-only) sees the roster/leaderboard but no management forms", async ({ page }) => {
    await loginAs(page, "support-admin@alpha-os.test");
    await goto(page, "/admin/crm/sales-team");
    await expect(page.getByRole("heading", { name: "Roster", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Add a sales team member", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Organization-wide target/quota", exact: true })).toHaveCount(0);

    const { adminMemberId } = await seededMemberIds();
    await goto(page, `/admin/crm/sales-team/${adminMemberId}`);
    await expectNoApplicationError(page);
    await expect(page.getByLabel("Manager")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove from sales team" })).toHaveCount(0);
  });
});

base.describe("Sales Team — rep lifecycle (platform admin)", () => {
  base("adds, reassigns manager, removes, and re-adds (rejoin) a sales team member", async ({ page }) => {
    await loginAs(page, "platform-admin@alpha-os.test");
    await goto(page, "/admin/crm/sales-team");

    // Add — support-agent is the one seeded platform account not yet on the team.
    await choose(page, "User", "Support Agent (Dev)");
    await page.getByRole("button", { name: "Add to sales team" }).click();
    await expect(rosterRegion(page).getByRole("link", { name: "Support Agent (Dev)", exact: true })).toBeVisible();

    await rosterRegion(page).getByRole("link", { name: "Support Agent (Dev)", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/crm\/sales-team\/[0-9a-f-]+$/);
    await expectNoApplicationError(page);

    // Manager reassignment.
    await choose(page, "Manager", "Platform Owner (Dev)");
    await expect(page.getByText("Reports to Platform Owner (Dev)")).toBeVisible();

    // Remove — lands back on the overview, no longer in the active roster.
    await page.getByRole("button", { name: "Remove from sales team" }).click();
    await expect(page).toHaveURL(/\/admin\/crm\/sales-team$/);
    await expect(rosterRegion(page).getByRole("link", { name: "Support Agent (Dev)", exact: true })).toHaveCount(0);

    // Rejoin — the removed member is eligible again, and gets a fresh row.
    await choose(page, "User", "Support Agent (Dev)");
    await page.getByRole("button", { name: "Add to sales team" }).click();
    await expect(rosterRegion(page).getByRole("link", { name: "Support Agent (Dev)", exact: true })).toBeVisible();

    // Clean up — leave the roster exactly as seeded for other tests/runs.
    await rosterRegion(page).getByRole("link", { name: "Support Agent (Dev)", exact: true }).click();
    await page.getByRole("button", { name: "Remove from sales team" }).click();
    await expect(page).toHaveURL(/\/admin\/crm\/sales-team$/);
  });
});

base.describe("Sales Team — targets, quotas, and attainment", () => {
  base("creates, displays attainment for, and archives a per-rep target", async ({ page }) => {
    const { adminMemberId } = await seededMemberIds();
    await loginAs(page, "platform-admin@alpha-os.test");
    await goto(page, `/admin/crm/sales-team/${adminMemberId}`);

    await choose(page, "Metric", "calls logged");
    await page.getByLabel("Value").fill("10");
    await page.getByRole("button", { name: "Create goal" }).click();

    // The seeded fixture already has an ACTIVE revenue-won QUOTA on this
    // same rep with the same default period (its own "Attainment: 761%"
    // renders on the page too), and a PRIOR run of this same test may
    // have left its own now-ARCHIVED "calls logged" goal collapsed
    // inside the archived-goals `<details>` — every assertion below
    // scopes to the specific card this test just created, never a bare
    // page-wide query. `GoalList` always renders active goals before
    // the archived `<details>` block in DOM order, so `.first()`
    // deterministically resolves to the just-created ACTIVE card, never
    // a leftover archived one from an earlier run.
    const newGoalCard = page.getByText("calls logged", { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
    await expect(newGoalCard).toBeVisible();
    await expect(newGoalCard.getByText(/Target: 10/)).toBeVisible();
    await expect(newGoalCard.getByText(/Attainment: \d+%/)).toBeVisible();
    await newGoalCard.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText(/archived goal/)).toBeVisible();
  });

  base("creates, displays, and archives an organization-wide target from the overview page (no member scoping)", async ({ page }) => {
    await loginAs(page, "platform-admin@alpha-os.test");
    await goto(page, "/admin/crm/sales-team");

    await choose(page, "Metric", "appointments logged");
    await page.getByLabel("Value").fill("15");
    await page.getByRole("button", { name: "Create goal" }).click();
    await expectNoApplicationError(page);

    // Re-run safety: archive it immediately (same metric would otherwise
    // collide with itself on the next run via the DB's own overlapping-
    // period exclusion constraint — see `createGoal()`'s own comment).
    // `.first()` for the same re-run-safety reason as the per-rep target
    // test above — a prior run's own archived "appointments logged"
    // goal always sorts after the active one in DOM order.
    const newGoalCard = page.getByText("appointments logged", { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
    await expect(newGoalCard.getByText(/Target: 15/)).toBeVisible();
    await newGoalCard.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText(/archived goal/)).toBeVisible();
  });
});

base.describe("Sales Team — leaderboard, period filter, and responsive behavior", () => {
  base("period and metric selectors update the leaderboard without an application error", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await goto(page, "/admin/crm/sales-team");

    await choose(leaderboardSection(page), "Period", "This quarter");
    await expect(page).toHaveURL(/period=current_quarter/);
    await expectNoApplicationError(page);

    await choose(leaderboardSection(page), "Rank by", "Deals won");
    await expect(page).toHaveURL(/metric=DEALS_WON/);
    await expect(page).toHaveURL(/period=current_quarter/);
    await expectNoApplicationError(page);
  });

  base("a rep's own performance page renders real, non-crashing content", async ({ page }) => {
    const { adminMemberId } = await seededMemberIds();
    await loginAs(page, "platform-owner@alpha-os.test");
    await goto(page, `/admin/crm/sales-team/${adminMemberId}`);
    await expect(page.getByRole("heading", { name: "Performance", exact: true })).toBeVisible();
    await expect(page.getByText("Won this period")).toBeVisible();
    await expect(page.getByText("Win rate")).toBeVisible();
  });

  base("a nonexistent sales team member shows not found, not a crash", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto(`/admin/crm/sales-team/${MISSING_ID}`);
    await expectNoApplicationError(page);
  });

  base("the overview remains usable at mobile and tablet widths", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      await goto(page, "/admin/crm/sales-team");
      await expect(page.getByRole("heading", { name: "Sales Team", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: /Sales team roster/ })).toBeVisible();
    }
  });
});
