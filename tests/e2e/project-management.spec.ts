import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Project Management E2E (Build 27 — Roadmap Module 21). Same direct
 * style/helpers as `client-onboarding.spec.ts` (Build 23) — SQL-seeded
 * prerequisite chains (converted customer, completed onboarding),
 * real browser interaction for the domain under test. Login budget kept
 * deliberately low (mirrors every prior build's own hard-learned rate-
 * limiter discipline): each `describe` block performs at most one or two
 * logins total, reusing the same authenticated `page` for every step
 * within a test rather than re-logging in per assertion.
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

async function expectNoApplicationError(page: Page) {
  await expect(page.locator("body")).not.toContainText("Application error");
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  await expectNoApplicationError(page);
}

/** A fresh customer organization + `CrmCompany` already converted to it — the manual-creation and template-instantiation prerequisite every test below needs. */
async function seedConvertedCustomer(): Promise<{ companyName: string }> {
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const suffix = Date.now();
    const companyName = `E2E Project Co ${suffix}`;
    const orgId = (await client.query("INSERT INTO organizations (id, name, display_name, slug, status, is_platform, created_at, updated_at) VALUES (gen_random_uuid(), $1, $1, $2, 'ACTIVE', false, now(), now()) RETURNING id", [companyName, `e2e-project-${suffix}`])).rows[0].id as string;
    await client.query("INSERT INTO crm_companies (id, organization_id, name, status, converted_to_organization_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', $3, now(), now())", [platformOrgId, companyName, orgId]);
    return { companyName };
  });
}

/** A fresh WON-deal → ACCEPTED-proposal → COMPLETED-onboarding chain, for the handoff test — mirrors `client-onboarding.spec.ts`'s own `seedEligibleDeal()` shape, taken one step further into COMPLETED. */
async function seedCompletedOnboarding(): Promise<{ companyName: string }> {
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const suffix = Date.now();
    const companyName = `E2E Handoff Co ${suffix}`;
    const orgId = (await client.query("INSERT INTO organizations (id, name, display_name, slug, status, is_platform, created_at, updated_at) VALUES (gen_random_uuid(), $1, $1, $2, 'ACTIVE', false, now(), now()) RETURNING id", [companyName, `e2e-handoff-${suffix}`])).rows[0].id as string;
    const companyId = (await client.query("INSERT INTO crm_companies (id, organization_id, name, status, converted_to_organization_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', $3, now(), now()) RETURNING id", [platformOrgId, companyName, orgId])).rows[0].id as string;
    const pipelineId = (await client.query("SELECT id FROM crm_pipelines WHERE organization_id = $1 AND is_default = true", [platformOrgId])).rows[0].id as string;
    const wonStageId = (await client.query("SELECT id FROM crm_pipeline_stages WHERE pipeline_id = $1 AND is_won = true", [pipelineId])).rows[0].id as string;
    const dealId = (
      await client.query(
        "INSERT INTO crm_deals (id, organization_id, pipeline_id, stage_id, company_id, title, value_minor_units, currency, status, won_at, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 500000, 'USD', 'WON', now(), $6, now(), now()) RETURNING id",
        [platformOrgId, pipelineId, wonStageId, companyId, `${companyName} — deal`, adminUserId],
      )
    ).rows[0].id as string;
    const proposalId = (
      await client.query("INSERT INTO crm_proposals (id, organization_id, deal_id, company_id, proposal_number, status, assigned_to_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACCEPTED', $5, now(), now()) RETURNING id", [
        platformOrgId,
        dealId,
        companyId,
        `E2E-H-${suffix}`,
        adminUserId,
      ])
    ).rows[0].id as string;
    const onboardingId = (
      await client.query(
        "INSERT INTO crm_client_onboardings (id, organization_id, deal_id, company_id, linked_organization_id, originating_proposal_id, status, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'COMPLETED', $6, now(), now()) RETURNING id",
        [platformOrgId, dealId, companyId, orgId, proposalId, adminUserId],
      )
    ).rows[0].id as string;
    void onboardingId;
    return { companyName };
  });
}

base.describe("Project Management — access control", () => {
  base("support agent (no delivery_projects permission) is denied the list page", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");
    await goto(page, "/admin/projects");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("support admin (read-only) sees the list but no New project / Templates actions", async ({ page }) => {
    await loginAs(page, "support-admin@alpha-os.test");
    await goto(page, "/admin/projects");
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "New project" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Templates" })).toHaveCount(0);
  });
});

base.describe("Project Management — full operational workflow (shared platform-admin session)", () => {
  base("creates a project, builds milestones/tasks/subtasks/dependencies (rejecting a cycle), posts a comment safely, runs QA, requires a second approver, and completes only once required work clears", async ({ page }) => {
    const { companyName } = await seedConvertedCustomer();
    await loginAs(page, "platform-admin@alpha-os.test");

    // --- Manual creation ---
    await goto(page, "/admin/projects/new");
    await page.locator("select[name=companyId]").selectOption({ label: companyName });
    const title = `E2E Project ${Date.now()}`;
    await page.fill("input[name=title]", title);
    await page.click('button:has-text("Create project")');
    await page.waitForURL(/\/admin\/projects\/[0-9a-f-]+$/);
    await expectNoApplicationError(page);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByText("DRAFT", { exact: false }).first()).toBeVisible();

    // DRAFT -> PLANNED -> ACTIVE so completion becomes reachable later.
    await page.click('button:has-text("Move to PLANNED")');
    await expectNoApplicationError(page);
    await page.click('button:has-text("Move to ACTIVE")');
    await expectNoApplicationError(page);

    // --- Milestones ---
    await page.getByRole("tab", { name: "Milestones" }).click();
    await page.fill("input[name=title]", "Discovery");
    await page.click('button:has-text("Add milestone")');
    await expectNoApplicationError(page);
    await expect(page.getByText("Discovery")).toBeVisible();

    // --- Tasks / subtasks ---
    await page.getByRole("tab", { name: "Tasks" }).click();
    await page.fill("input[name=title]", "Task A");
    await page.click('button:has-text("Add task")');
    await expectNoApplicationError(page);
    // `.first()` — "Task A" also appears as an option in the "Parent task"
    // select below (every root task is a valid subtask parent); the task
    // card itself renders first in DOM order.
    await expect(page.getByText("Task A").first()).toBeVisible();

    await page.fill("input[name=title]", "Task B");
    await page.click('button:has-text("Add task")');
    await expectNoApplicationError(page);
    // Waits for the revalidated page to actually reflect Task B before
    // moving on — without this, the dependency selects below race the
    // Server Action's own `revalidatePath()` round trip and can still
    // reflect the pre-Task-B option list.
    await expect(page.getByText("Task B").first()).toBeVisible();

    await page.fill("input[name=title]", "Task C");
    await page.click('button:has-text("Add task")');
    await expectNoApplicationError(page);
    await expect(page.getByText("Task C").first()).toBeVisible();

    // A subtask of Task A.
    const parentSelect = page.locator("select[name=parentTaskId]");
    await parentSelect.selectOption({ label: "Task A" });
    await page.fill("input[name=title]", "Subtask of A");
    await page.click('button:has-text("Add task")');
    await expectNoApplicationError(page);
    // `.first()` — "Subtask of A" also appears as an option in both
    // dependency selects below (every task is a valid dependency
    // endpoint); the task card itself renders first in DOM order.
    await expect(page.getByText("Subtask of A").first()).toBeVisible();

    // Dependencies: B depends on A, C depends on B — then REQUIRED CASE:
    // A depends on C must be rejected as a cycle.
    async function addDependency(taskLabel: string, dependsOnLabel: string) {
      const selects = page.locator('form:has(button:has-text("Add dependency")) select');
      await selects.nth(0).selectOption({ label: taskLabel });
      await selects.nth(1).selectOption({ label: dependsOnLabel });
      await page.click('button:has-text("Add dependency")');
    }
    await addDependency("Task B", "Task A");
    await expectNoApplicationError(page);
    await expect(page.getByText("Depends on: Task A")).toBeVisible();
    await addDependency("Task C", "Task B");
    await expectNoApplicationError(page);
    // React resets uncontrolled form fields back to their first option
    // after EVERY action submission (success or error) — this wait lets
    // that reset settle before the next `addDependency()` call starts
    // re-selecting values, so it can't race a fresh reset back to
    // whatever the first `<option>` happens to be.
    await expect(page.getByText("Depends on: Task B")).toBeVisible();
    await addDependency("Task A", "Task C");
    await expect(page.getByText(/cycle/i)).toBeVisible();

    // --- Comments: stored-XSS proof ---
    await page.getByRole("tab", { name: "Comments" }).click();
    const xssPayload = "<script>window.__e2eXss = true;</script>Safe text";
    await page.fill("textarea[name=body]", xssPayload);
    await page.click('button:has-text("Post comment")');
    await expectNoApplicationError(page);
    // Rendered as a text node (never innerHTML) — the literal tag text is
    // visible on the page, and the script itself never executed.
    await expect(page.getByText(xssPayload, { exact: false })).toBeVisible();
    const xssRan = await page.evaluate(() => (window as unknown as { __e2eXss?: boolean }).__e2eXss);
    expect(xssRan).toBeUndefined();

    // --- QA ---
    await page.getByRole("tab", { name: "QA" }).click();
    await page.fill("input[name=title]", "Launch checklist");
    await page.click('button:has-text("Add QA check")');
    await expectNoApplicationError(page);
    await page.click('button:has-text("Pass")');
    await expectNoApplicationError(page);
    await expect(page.getByText("PASSED", { exact: false }).first()).toBeVisible();

    // --- Approvals: request, then verify self-approval is not offered ---
    await page.getByRole("tab", { name: "Approvals" }).click();
    await page.click('button:has-text("Request approval")');
    await expectNoApplicationError(page);
    // The requester (platform-admin) holds delivery_projects.approve too,
    // but MUST NOT see decide controls on their OWN request.
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);

    // A completion attempt now must be denied — Task B/C/subtask/root
    // tasks are still open, so "Complete" is disabled or absent; the
    // outstanding-gates message names them.
    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page.getByText(/Not yet ready to complete/)).toBeVisible();
  });

  base("a second approver can decide a pending approval, and completing every required task clears the way to COMPLETED", async ({ page }) => {
    const { companyName } = await seedConvertedCustomer();
    await loginAs(page, "platform-admin@alpha-os.test");
    await goto(page, "/admin/projects/new");
    await page.locator("select[name=companyId]").selectOption({ label: companyName });
    const title = `E2E Completion ${Date.now()}`;
    await page.fill("input[name=title]", title);
    await page.click('button:has-text("Create project")');
    await page.waitForURL(/\/admin\/projects\/[0-9a-f-]+$/);
    const projectUrl = page.url();
    await page.click('button:has-text("Move to PLANNED")');
    await page.click('button:has-text("Move to ACTIVE")');

    await page.getByRole("tab", { name: "Tasks" }).click();
    await page.fill("input[name=title]", "Only task");
    await page.click('button:has-text("Add task")');
    await expectNoApplicationError(page);
    await page.click('button:has-text("Complete")');
    await expectNoApplicationError(page);
    await expect(page.getByText("DONE", { exact: false }).first()).toBeVisible();

    await page.getByRole("tab", { name: "Approvals" }).click();
    await page.click('button:has-text("Request approval")');
    await expectNoApplicationError(page);

    // A DIFFERENT platform user decides it — this is the one deliberate
    // second login in this spec (self-approval must be tested against a
    // real different actor, not merely a hidden button).
    await loginAs(page, "platform-owner@alpha-os.test");
    await goto(page, projectUrl);
    await page.getByRole("tab", { name: "Approvals" }).click();
    await page.click('button:has-text("Approve")');
    await expectNoApplicationError(page);
    await expect(page.getByText("APPROVED", { exact: false }).first()).toBeVisible();

    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page.getByText(/Not yet ready to complete/)).toHaveCount(0);
    await page.click('button:has-text("Complete")');
    await expectNoApplicationError(page);
    await expect(page.getByText("COMPLETED", { exact: false }).first()).toBeVisible();
  });
});

base.describe("Project Management — onboarding handoff and templates (shared platform-admin session)", () => {
  base("hands off a completed onboarding into a new project, and instantiating a template snapshots its structure", async ({ page }) => {
    const { companyName } = await seedCompletedOnboarding();
    await loginAs(page, "platform-admin@alpha-os.test");

    await goto(page, "/admin/projects/new");
    await page.locator("select[name=onboardingId]").selectOption({ label: companyName });
    const title = `E2E Handoff Project ${Date.now()}`;
    await page.locator('form:has(select[name=onboardingId]) input[name=title]').fill(title);
    await page.click('button:has-text("Create project from onboarding")');
    await page.waitForURL(/\/admin\/projects\/[0-9a-f-]+$/);
    await expectNoApplicationError(page);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByText("Onboarding handoff")).toBeVisible();

    // Templates.
    const { companyName: templateCompanyName } = await seedConvertedCustomer();
    await goto(page, "/admin/projects/templates");
    const templateName = `E2E Template ${Date.now()}`;
    await page.fill("input[name=name]", templateName);
    await page.click('button:has-text("Create template")');
    await page.waitForURL(/\/admin\/projects\/templates\/[0-9a-f-]+$/);
    await expectNoApplicationError(page);

    await page.fill("input[name=title]", "Template milestone");
    await page.click('button:has-text("Add milestone")');
    await expectNoApplicationError(page);
    await page.locator('form:has(button:has-text("Add task")) input[name=title]').fill("Template task");
    await page.click('button:has-text("Add task")');
    await expectNoApplicationError(page);

    await page.locator("select[name=companyId]").selectOption({ label: templateCompanyName });
    await page.click('button:has-text("Create project from template")');
    await page.waitForURL(/\/admin\/projects\/[0-9a-f-]+$/);
    await expectNoApplicationError(page);
    await page.getByRole("tab", { name: "Tasks" }).click();
    // `.first()` — same "also a Parent-task select option" ambiguity as above.
    await expect(page.getByText("Template task").first()).toBeVisible();
  });
});

base.describe("Project Management — not-found and responsive behavior", () => {
  base("a nonexistent project shows not found, not a crash", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto(`/admin/projects/${MISSING_ID}`);
    await expectNoApplicationError(page);
  });

  base("the projects list remains usable at mobile and tablet widths", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      await goto(page, "/admin/projects");
      await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    }
  });
});
