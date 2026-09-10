import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Customer Portal — Projects E2E (Build 27 — Roadmap Module 21). Same
 * shared-session/self-identifying-fixture discipline `portal.spec.ts`
 * (Build 26) already established — see that file's own top comment for
 * the full reasoning (the real `authRateLimiter` is 10 requests/15min
 * per email; every fixture below carries a `Date.now()` suffix so no
 * assertion depends on seed ordering or "the first row").
 *
 * Seeds `Project`/`Milestone`/`ProjectTask`/`ProjectComment` rows
 * DIRECTLY via SQL (not through the internal admin UI — that workflow
 * is `project-management.spec.ts`'s own subject) so this file can focus
 * on the ONE thing that matters here: the customer-safe projection
 * boundary itself.
 */
let ownerContext: BrowserContext;
let ownerPage: Page;

base.beforeAll(async ({ browser, baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);

  ownerContext = await browser.newContext();
  ownerPage = await ownerContext.newPage();
  await loginAs(ownerPage, "owner-a@alpha-os.test");
});

base.afterAll(async () => {
  await ownerContext?.close();
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

interface SeededProject {
  projectId: string;
  title: string;
  visibleMilestoneTitle: string;
  hiddenMilestoneTitle: string;
  visibleTaskTitle: string;
  hiddenTaskTitle: string;
  taskUnderHiddenMilestoneTitle: string;
  visibleCommentBody: string;
  internalCommentBody: string;
  commentOnHiddenTaskBody: string;
}

/**
 * A project for Acme Corp (`owner-a@alpha-os.test`'s own organization —
 * already has a converted `CrmCompany`, reused directly rather than
 * re-seeding one) exercising every visibility boundary in one shot:
 * a customer-visible milestone/task/comment, an internal-only
 * milestone/task/comment, and — the one Codex Security Engineer flagged
 * as the subtle case (finding traced safe, re-verified here) — a
 * customer-visible comment attached to a task that is itself hidden.
 */
async function seedAcmeProject(): Promise<SeededProject> {
  const suffix = Date.now();
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const acmeOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'acme-corp-dev'")).rows[0].id as string;
    const acmeCompanyId = (await client.query("SELECT id FROM crm_companies WHERE converted_to_organization_id = $1", [acmeOrgId])).rows[0].id as string;

    const title = `E2E Portal Project ${suffix}`;
    const projectId = (
      await client.query(
        "INSERT INTO projects (id, organization_id, customer_organization_id, company_id, title, status, priority, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACTIVE', 'MEDIUM', $5, now(), now()) RETURNING id",
        [platformOrgId, acmeOrgId, acmeCompanyId, title, adminUserId],
      )
    ).rows[0].id as string;

    const visibleMilestoneTitle = `Visible Milestone ${suffix}`;
    const hiddenMilestoneTitle = `Hidden Milestone ${suffix}`;
    const visibleMilestoneId = (
      await client.query("INSERT INTO milestones (id, organization_id, project_id, title, sort_order, customer_visible, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 1000, true, $4, now(), now()) RETURNING id", [
        platformOrgId,
        projectId,
        visibleMilestoneTitle,
        adminUserId,
      ])
    ).rows[0].id as string;
    const hiddenMilestoneId = (
      await client.query("INSERT INTO milestones (id, organization_id, project_id, title, sort_order, customer_visible, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 2000, false, $4, now(), now()) RETURNING id", [
        platformOrgId,
        projectId,
        hiddenMilestoneTitle,
        adminUserId,
      ])
    ).rows[0].id as string;

    const visibleTaskTitle = `Visible Task ${suffix}`;
    const hiddenTaskTitle = `Hidden Task ${suffix}`;
    const taskUnderHiddenMilestoneTitle = `Task Under Hidden Milestone ${suffix}`;
    await client.query("INSERT INTO project_tasks (id, organization_id, project_id, milestone_id, title, status, priority, sort_order, customer_visible, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'TODO', 'MEDIUM', 1000, true, $5, now(), now())", [
      platformOrgId,
      projectId,
      visibleMilestoneId,
      visibleTaskTitle,
      adminUserId,
    ]);
    const hiddenTaskId = (
      await client.query("INSERT INTO project_tasks (id, organization_id, project_id, title, status, priority, sort_order, customer_visible, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'TODO', 'MEDIUM', 2000, false, $4, now(), now()) RETURNING id", [
        platformOrgId,
        projectId,
        hiddenTaskTitle,
        adminUserId,
      ])
    ).rows[0].id as string;
    await client.query("INSERT INTO project_tasks (id, organization_id, project_id, milestone_id, title, status, priority, sort_order, customer_visible, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'TODO', 'MEDIUM', 3000, false, $5, now(), now())", [
      platformOrgId,
      projectId,
      hiddenMilestoneId,
      taskUnderHiddenMilestoneTitle,
      adminUserId,
    ]);

    const visibleCommentBody = `Visible update ${suffix}`;
    const internalCommentBody = `Internal note ${suffix} — never for the customer`;
    const commentOnHiddenTaskBody = `Comment on hidden task ${suffix} — must stay hidden too`;
    await client.query("INSERT INTO project_comments (id, organization_id, project_id, author_user_id, body, visibility, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'CUSTOMER_VISIBLE', now(), now())", [platformOrgId, projectId, adminUserId, visibleCommentBody]);
    await client.query("INSERT INTO project_comments (id, organization_id, project_id, author_user_id, body, visibility, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'INTERNAL', now(), now())", [platformOrgId, projectId, adminUserId, internalCommentBody]);
    // The subtle case: a CUSTOMER_VISIBLE comment on a task that is itself hidden.
    await client.query("INSERT INTO project_comments (id, organization_id, project_id, task_id, author_user_id, body, visibility, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'CUSTOMER_VISIBLE', now(), now())", [
      platformOrgId,
      projectId,
      hiddenTaskId,
      adminUserId,
      commentOnHiddenTaskBody,
    ]);

    return { projectId, title, visibleMilestoneTitle, hiddenMilestoneTitle, visibleTaskTitle, hiddenTaskTitle, taskUnderHiddenMilestoneTitle, visibleCommentBody, internalCommentBody, commentOnHiddenTaskBody };
  });
}

/** A project for a FRESH, unrelated customer organization — never visible to `owner-a`, the one cross-tenant negative fixture this file needs. */
async function seedForeignProject(): Promise<{ projectId: string }> {
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const suffix = Date.now();
    const foreignOrgId = (await client.query("INSERT INTO organizations (id, name, display_name, slug, status, is_platform, created_at, updated_at) VALUES (gen_random_uuid(), $1, $1, $2, 'ACTIVE', false, now(), now()) RETURNING id", [`E2E Foreign Portal Co ${suffix}`, `e2e-foreign-portal-${suffix}`])).rows[0].id as string;
    const foreignCompanyId = (
      await client.query("INSERT INTO crm_companies (id, organization_id, name, status, converted_to_organization_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', $3, now(), now()) RETURNING id", [platformOrgId, `E2E Foreign Portal Co ${suffix}`, foreignOrgId])
    ).rows[0].id as string;
    const projectId = (
      await client.query(
        "INSERT INTO projects (id, organization_id, customer_organization_id, company_id, title, status, priority, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACTIVE', 'MEDIUM', $5, now(), now()) RETURNING id",
        [platformOrgId, foreignOrgId, foreignCompanyId, `E2E Foreign Portal Project ${suffix}`, adminUserId],
      )
    ).rows[0].id as string;
    return { projectId };
  });
}

base.describe("Customer Portal — Projects (shared owner-a session)", () => {
  base("My Projects lists the seeded project with real progress, and the detail page shows exactly the customer-safe subset — nothing hidden leaks", async () => {
    const seeded = await seedAcmeProject();

    await goto(ownerPage, "/portal/projects");
    await expect(ownerPage.getByText(seeded.title)).toBeVisible();
    await ownerPage.getByText(seeded.title).click();
    await ownerPage.waitForURL(/\/portal\/projects\/[0-9a-f-]+$/);
    await expectNoApplicationError(ownerPage);

    // Visible.
    await expect(ownerPage.getByRole("heading", { name: seeded.title, exact: true })).toBeVisible();
    await expect(ownerPage.getByText(seeded.visibleMilestoneTitle)).toBeVisible();
    await expect(ownerPage.getByText(seeded.visibleTaskTitle)).toBeVisible();
    await expect(ownerPage.getByText(seeded.visibleCommentBody)).toBeVisible();

    // Hidden — none of this text should ever reach the page.
    for (const hidden of [seeded.hiddenMilestoneTitle, seeded.hiddenTaskTitle, seeded.taskUnderHiddenMilestoneTitle, seeded.internalCommentBody, seeded.commentOnHiddenTaskBody]) {
      await expect(ownerPage.getByText(hidden)).toHaveCount(0);
    }

    // No internal-only concepts appear anywhere on this page at all —
    // QA/approvals/dependencies are not part of this build's Portal
    // scope (see project-management.md "Customer Portal integration").
    await expect(ownerPage.getByText(/QA check/i)).toHaveCount(0);
    await expect(ownerPage.getByText(/approval/i)).toHaveCount(0);
  });

  base("a forged/foreign project id resolves to not-found, never a crash or another customer's data", async () => {
    const { projectId: foreignProjectId } = await seedForeignProject();

    await ownerPage.goto(`/portal/projects/${foreignProjectId}`);
    await expectNoApplicationError(ownerPage);
    await expect(ownerPage.getByText(/could not be found/i)).toBeVisible();

    await ownerPage.goto(`/portal/projects/${MISSING_ID}`);
    await expectNoApplicationError(ownerPage);
  });
});

base.describe("Customer Portal — Projects access control", () => {
  base("a pure platform-staff user with no customer organization sees an honest empty state, not a crash", async ({ page }) => {
    await loginAs(page, "support@alpha-os.test");
    await goto(page, "/portal/projects");
  });
});
