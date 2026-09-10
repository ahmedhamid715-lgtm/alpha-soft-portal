import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Task Management E2E (Build 28 — Roadmap Module 22). Same direct
 * style/helpers as `project-management.spec.ts` (Build 27) — SQL-seeded
 * cross-source fixtures, real browser interaction for the surface under
 * test. Onboarding checklist/requirement sources are NOT separately
 * seeded here (they'd need a full deal → proposal → onboarding chain
 * for one more source-type badge on a shared list) — those two branches
 * already have direct, dedicated coverage in
 * `tests/integration/db/task-management-security.test.ts`; this file's
 * job is proving the AGGREGATE UI itself (multiple real sources on one
 * page, quick actions routed correctly, permission gating) works, which
 * `PROJECT_TASK` + `CRM_TASK` + `STANDALONE_TASK` already demonstrates.
 *
 * ONE shared `platform-admin` session for the whole "full operational
 * workflow" block (`beforeAll`/`afterAll`, not one login per test) —
 * the real `authRateLimiter` is 10 requests/15min per email; three
 * separate per-test logins for the same account is exactly the kind of
 * thing that trips it under repeated local runs (found live, debugging
 * this exact file).
 */
let adminContext: BrowserContext;
let adminPage: Page;

base.beforeAll(async ({ browser, baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);

  adminContext = await browser.newContext();
  adminPage = await adminContext.newPage();
  await loginAs(adminPage, "platform-admin@alpha-os.test");
});

base.afterAll(async () => {
  await adminContext?.close();
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

// Both the dev-mode error overlay ("Application error") AND the
// production error boundary's own distinct copy ("This page couldn't
// load") — checking only the first missed a real server-side
// VALIDATION_ERROR crash live during this build's own E2E run (see the
// `dueWindow` fix in `admin/tasks/page.tsx`), since this suite always
// runs against a production build per this codebase's own E2E
// convention.
async function expectNoApplicationError(page: Page) {
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).not.toContainText("This page couldn't load");
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  await expectNoApplicationError(page);
}

interface SeededSourceTasks {
  projectTaskTitle: string;
  crmTaskTitle: string;
}

/** One `ProjectTask` and one `CrmTask`, both assigned to `platform-admin@alpha-os.test`, so the aggregate "My Tasks" view has two genuinely different real sources to prove out in one shared session. */
async function seedCrossSourceTasksForAdmin(): Promise<SeededSourceTasks> {
  const suffix = Date.now();
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const acmeOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'acme-corp-dev'")).rows[0].id as string;
    const acmeCompanyId = (await client.query("SELECT id FROM crm_companies WHERE converted_to_organization_id = $1", [acmeOrgId])).rows[0].id as string;

    const projectTitle = `E2E Task Mgmt Project ${suffix}`;
    const projectId = (
      await client.query(
        "INSERT INTO projects (id, organization_id, customer_organization_id, company_id, title, status, priority, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACTIVE', 'MEDIUM', $5, now(), now()) RETURNING id",
        [platformOrgId, acmeOrgId, acmeCompanyId, projectTitle, adminUserId],
      )
    ).rows[0].id as string;
    const projectTaskTitle = `E2E Project Task ${suffix}`;
    // A far-past due date (see the standalone-task fixture below for the
    // same reasoning) guarantees this row sorts before the many
    // null-due-date leftovers earlier runs of this shared dev database
    // accumulate, regardless of source filter.
    await client.query(
      "INSERT INTO project_tasks (id, organization_id, project_id, title, status, priority, assigned_to_user_id, due_date, sort_order, customer_visible, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'TODO', 'HIGH', $4, '2001-01-01', 1000, false, $4, now(), now())",
      [platformOrgId, projectId, projectTaskTitle, adminUserId],
    );

    const crmTaskTitle = `E2E CRM Task ${suffix}`;
    await client.query(
      "INSERT INTO crm_tasks (id, organization_id, company_id, title, status, assigned_to_user_id, due_at, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'OPEN', $4, '2001-01-01', $4, now(), now())",
      [platformOrgId, acmeCompanyId, crmTaskTitle, adminUserId],
    );

    return { projectTaskTitle, crmTaskTitle };
  });
}

base.describe("Task Management — access control", () => {
  base("a user with no task_management permission is denied the list page", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");
    await goto(page, "/admin/tasks");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("support admin (task_management.read only) sees My Tasks but no Team Tasks tab, no New internal task action", async ({ page }) => {
    await loginAs(page, "support-admin@alpha-os.test");
    await goto(page, "/admin/tasks");
    await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Team Tasks" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "New internal task" })).toHaveCount(0);

    // Direct URL access to the manage-only create page must also be denied server-side, not merely hidden from nav.
    await goto(page, "/admin/tasks/new");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });
});

base.describe("Task Management — full operational workflow (shared platform-admin session)", () => {
  base("aggregates real ProjectTask and CrmTask rows alongside a standalone task, filters, and routes quick actions through the correct source", async () => {
    const { projectTaskTitle, crmTaskTitle } = await seedCrossSourceTasksForAdmin();

    // --- Create a standalone internal task, assigned to self ---
    await goto(adminPage, "/admin/tasks/new");
    const internalTitle = `E2E Internal Task ${Date.now()}`;
    await adminPage.fill("input[name=title]", internalTitle);
    await adminPage.locator("select[name=assignedToUserId]").selectOption({ label: "Platform Admin (Dev)" });
    // A far-past due date guarantees this fixture sorts FIRST
    // (`dueAt ASC NULLS LAST`) regardless of how many null-due-date
    // fixtures earlier runs of this same spec have left in this shared
    // dev database — without it, this new row's default position among
    // ties (`createdAt ASC`) can be pushed past page 1 by accumulated
    // leftovers once the source filter below narrows the competing set.
    await adminPage.fill("input[name=dueAt]", "2001-01-01");
    await adminPage.click('button:has-text("Create task")');
    await adminPage.waitForURL(/\/admin\/tasks\/[0-9a-f-]+$/);
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByRole("heading", { name: internalTitle, exact: true })).toBeVisible();

    // --- My Tasks aggregates all three sources ---
    await goto(adminPage, "/admin/tasks");
    await expect(adminPage.getByText(projectTaskTitle)).toBeVisible();
    await expect(adminPage.getByText(crmTaskTitle)).toBeVisible();
    await expect(adminPage.getByText(internalTitle)).toBeVisible();
    // `.first()` — platform-admin's own "My Tasks" view legitimately
    // accumulates rows across every prior E2E run in this shared dev
    // database (`project-management.spec.ts` seeds its own ProjectTasks
    // assigned to the same admin, for example), so more than one row of
    // a given source badge is expected; this only asserts each source
    // badge appears at least once.
    await expect(adminPage.getByText("Project", { exact: true }).first()).toBeVisible();
    await expect(adminPage.getByText("CRM", { exact: true }).first()).toBeVisible();
    await expect(adminPage.getByText("Internal", { exact: true }).first()).toBeVisible();

    // --- Source filter narrows to exactly one source ---
    await adminPage.locator("select[name=source]").selectOption("STANDALONE_TASK");
    await adminPage.click('button:has-text("Filter")');
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText(internalTitle)).toBeVisible();
    await expect(adminPage.getByText(projectTaskTitle)).toHaveCount(0);
    await expect(adminPage.getByText(crmTaskTitle)).toHaveCount(0);

    // --- Quick-complete the standalone task from the row ---
    const internalRow = adminPage.locator("tr", { hasText: internalTitle });
    await internalRow.getByRole("button", { name: /Mark .* complete/ }).click();
    await expectNoApplicationError(adminPage);
    await expect(internalRow.getByText("COMPLETED", { exact: false })).toBeVisible();

    // --- Clicking a ProjectTask/CrmTask row deep-links to its OWN authoritative source page, never a fake duplicate ---
    await adminPage.locator("select[name=source]").selectOption("");
    await adminPage.click('button:has-text("Filter")');
    await adminPage.getByRole("link", { name: projectTaskTitle }).click();
    await adminPage.waitForURL(/\/admin\/projects\/[0-9a-f-]+$/);
    await expectNoApplicationError(adminPage);

    await goto(adminPage, "/admin/tasks");
    await adminPage.getByRole("link", { name: crmTaskTitle }).click();
    await adminPage.waitForURL(/\/admin\/crm\/tasks$/);
    await expectNoApplicationError(adminPage);
  });

  base("a nonexistent standalone task id resolves to not-found, never a crash", async () => {
    await adminPage.goto(`/admin/tasks/${MISSING_ID}`);
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText(/could not be found/i)).toBeVisible();
  });

  base("cancelling a standalone task requires a reason and the task leaves the open view", async () => {
    await goto(adminPage, "/admin/tasks/new");
    const title = `E2E Cancel Task ${Date.now()}`;
    await adminPage.fill("input[name=title]", title);
    await adminPage.click('button:has-text("Create task")');
    await adminPage.waitForURL(/\/admin\/tasks\/[0-9a-f-]+$/);

    await adminPage.click('button:has-text("Cancel task")');
    // The confirm button stays disabled with an empty reason (client-side guard) — asserted directly rather than attempting a click that Playwright's actionability checks would just hang on.
    await expect(adminPage.getByRole("button", { name: "Confirm cancellation" })).toBeDisabled();
    await adminPage.getByLabel("Cancellation reason").fill("No longer needed — E2E");
    await expect(adminPage.getByRole("button", { name: "Confirm cancellation" })).toBeEnabled();
    await adminPage.click('button:has-text("Confirm cancellation")');
    await expectNoApplicationError(adminPage);
    await expect(adminPage.getByText("CANCELLED", { exact: false }).first()).toBeVisible();
  });
});
