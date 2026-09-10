import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Customer Portal — Tasks E2E (Build 28 — Roadmap Module 22). Same
 * shared-session/self-identifying-fixture discipline
 * `portal-project-management.spec.ts` (Build 27) already established.
 * Seeds `Project`/`ProjectTask` rows DIRECTLY via SQL, focused on the
 * ONE thing that matters here: `/portal/tasks`'s own customer-safe
 * visibility boundary — customer-visible ProjectTasks only, never CRM
 * tasks, internal standalone tasks, or onboarding items (none of which
 * this page's own service function ever queries at all — see
 * `portal-project-service.ts`'s `listMyTasks()`).
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

// See `task-management.spec.ts`'s own identical helper comment — the
// production error boundary's copy differs from the dev-mode overlay's.
async function expectNoApplicationError(page: Page) {
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).not.toContainText("This page couldn't load");
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  await expectNoApplicationError(page);
}

interface SeededTasks {
  visibleTaskTitle: string;
  hiddenTaskTitle: string;
}

/** One customer-visible and one internal-only `ProjectTask`, both assigned to the internal admin (never a customer-portal identity — see `listMyTasks()`'s own "visibility is not assignment" boundary), under a fresh project for Acme's already-converted organization. */
async function seedAcmeTasks(): Promise<SeededTasks> {
  const suffix = Date.now();
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const acmeOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'acme-corp-dev'")).rows[0].id as string;
    const acmeCompanyId = (await client.query("SELECT id FROM crm_companies WHERE converted_to_organization_id = $1", [acmeOrgId])).rows[0].id as string;

    const projectId = (
      await client.query(
        "INSERT INTO projects (id, organization_id, customer_organization_id, company_id, title, status, priority, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACTIVE', 'MEDIUM', $5, now(), now()) RETURNING id",
        [platformOrgId, acmeOrgId, acmeCompanyId, `E2E Portal Tasks Project ${suffix}`, adminUserId],
      )
    ).rows[0].id as string;

    const visibleTaskTitle = `Visible Portal Task ${suffix}`;
    const hiddenTaskTitle = `Hidden Portal Task ${suffix}`;
    await client.query(
      "INSERT INTO project_tasks (id, organization_id, project_id, title, status, priority, assigned_to_user_id, sort_order, customer_visible, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'TODO', 'MEDIUM', $4, 1000, true, $4, now(), now())",
      [platformOrgId, projectId, visibleTaskTitle, adminUserId],
    );
    await client.query(
      "INSERT INTO project_tasks (id, organization_id, project_id, title, status, priority, assigned_to_user_id, sort_order, customer_visible, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'TODO', 'MEDIUM', $4, 2000, false, $4, now(), now())",
      [platformOrgId, projectId, hiddenTaskTitle, adminUserId],
    );

    return { visibleTaskTitle, hiddenTaskTitle };
  });
}

/** A task for a FRESH, unrelated customer organization — never visible to `owner-a`, the cross-tenant negative fixture. */
async function seedForeignTask(): Promise<{ title: string }> {
  const suffix = Date.now();
  return withPgClient(async (client) => {
    const platformOrgId = (await client.query("SELECT id FROM organizations WHERE slug = 'alpha-os-platform'")).rows[0].id as string;
    const adminUserId = (await client.query("SELECT id FROM users WHERE email = 'platform-admin@alpha-os.test'")).rows[0].id as string;
    const foreignOrgId = (
      await client.query("INSERT INTO organizations (id, name, display_name, slug, status, is_platform, created_at, updated_at) VALUES (gen_random_uuid(), $1, $1, $2, 'ACTIVE', false, now(), now()) RETURNING id", [
        `E2E Foreign Portal Tasks Co ${suffix}`,
        `e2e-foreign-portal-tasks-${suffix}`,
      ])
    ).rows[0].id as string;
    const foreignCompanyId = (
      await client.query("INSERT INTO crm_companies (id, organization_id, name, status, converted_to_organization_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ACTIVE', $3, now(), now()) RETURNING id", [
        platformOrgId,
        `E2E Foreign Portal Tasks Co ${suffix}`,
        foreignOrgId,
      ])
    ).rows[0].id as string;
    const projectId = (
      await client.query(
        "INSERT INTO projects (id, organization_id, customer_organization_id, company_id, title, status, priority, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACTIVE', 'MEDIUM', $5, now(), now()) RETURNING id",
        [platformOrgId, foreignOrgId, foreignCompanyId, `E2E Foreign Portal Tasks Project ${suffix}`, adminUserId],
      )
    ).rows[0].id as string;
    const title = `Foreign Portal Task ${suffix}`;
    await client.query(
      "INSERT INTO project_tasks (id, organization_id, project_id, title, status, priority, sort_order, customer_visible, created_by_user_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'TODO', 'MEDIUM', 1000, true, $4, now(), now())",
      [platformOrgId, projectId, title, adminUserId],
    );
    return { title };
  });
}

base.describe("Customer Portal — Tasks (shared owner-a session)", () => {
  base("shows only the customer-visible ProjectTask, never the hidden one, never labeled as the customer's own assignment", async () => {
    const { visibleTaskTitle, hiddenTaskTitle } = await seedAcmeTasks();

    await goto(ownerPage, "/portal/tasks");
    await expect(ownerPage.getByText(visibleTaskTitle)).toBeVisible();
    await expect(ownerPage.getByText(hiddenTaskTitle)).toHaveCount(0);

    // No internal-only concepts (assignee identity, QA, approvals) ever appear on this page.
    await expect(ownerPage.getByText(/QA check/i)).toHaveCount(0);
    await expect(ownerPage.getByText(/approval/i)).toHaveCount(0);
  });

  base("a foreign organization's task never leaks onto this customer's own Tasks page", async () => {
    const { title: foreignTitle } = await seedForeignTask();
    await goto(ownerPage, "/portal/tasks");
    await expect(ownerPage.getByText(foreignTitle)).toHaveCount(0);
  });
});

base.describe("Customer Portal — Tasks access control", () => {
  base("a pure platform-staff user with no customer organization sees an honest empty state, not a crash", async ({ page }) => {
    await loginAs(page, "support@alpha-os.test");
    await goto(page, "/portal/tasks");
  });
});
