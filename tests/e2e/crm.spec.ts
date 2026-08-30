import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

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

async function seededCrmIds() {
  const organizationId = await orgIdBySlug("alpha-os-platform");
  return withPgClient(async (client) => {
    const company = await client.query("SELECT id FROM crm_companies WHERE organization_id = $1 AND name = $2", [organizationId, "Acme Retail Group"]);
    const lead = await client.query("SELECT id FROM crm_leads WHERE organization_id = $1 AND title = $2", [organizationId, "SEO audit + local landing pages — Acme Retail Group"]);
    return { companyId: company.rows[0].id as string, leadId: lead.rows[0].id as string };
  });
}

async function expectNoApplicationError(page: Page) {
  await expect(page.locator("body")).not.toContainText("Application error");
}

/**
 * `scope` is where the trigger lives (sometimes a sub-section
 * `Locator`, to disambiguate two same-labeled "Type" selects on the
 * settings page); the resulting listbox is NOT — Radix `SelectContent`
 * portals to `document.body`, outside `scope`'s own DOM subtree, so the
 * option itself must always be queried against the real top-level
 * `Page`, never re-scoped to `scope`. Found live by actually running
 * this spec (Codex's own sandbox couldn't launch Chromium to catch it).
 */
async function choose(scope: Page | Locator, label: string, option: string) {
  const rootPage = "page" in scope && typeof (scope as Locator).page === "function" ? (scope as Locator).page() : (scope as Page);
  await scope.getByLabel(label).click();
  await rootPage.getByRole("option", { name: option, exact: true }).click();
}

base.describe("CRM — access control and discoverability", () => {
  base("unauthenticated users are redirected away from CRM", async ({ page }) => {
    await page.goto("/admin/crm");
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  base("platform owner reaches CRM from both sidebar navigation and the admin landing card", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.getByRole("link", { name: "CRM", exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/crm$/);
    await expect(page.getByRole("heading", { name: "CRM", exact: true })).toBeVisible();

    await page.goto("/admin");
    // Not `exact: true` — the admin landing page's own card link
    // (`admin/page.tsx`) wraps the tool's label AND its description in
    // one `<Link>`, so its accessible name is "CRM <description>", the
    // same reasoning `knowledge.spec.ts`'s own equivalent test already
    // applies to its "Knowledge" card link.
    await page.getByRole("main").getByRole("link", { name: "CRM" }).click();
    await expect(page).toHaveURL(/\/admin\/crm$/);
    await expect(page.getByRole("heading", { name: "CRM", exact: true })).toBeVisible();
  });

  base("support agent cannot discover or access CRM, including seeded detail URLs", async ({ page }) => {
    const { companyId, leadId } = await seededCrmIds();
    await loginAs(page, "support-agent@alpha-os.test");
    await page.goto("/admin");
    await expect(page.getByRole("link", { name: "CRM", exact: true })).toHaveCount(0);

    for (const path of ["/admin/crm", "/admin/crm/companies", "/admin/crm/leads", `/admin/crm/companies/${companyId}`, `/admin/crm/leads/${leadId}`]) {
      await page.goto(path);
      await expect(page.getByText("You don't have access to this page")).toBeVisible();
      await expectNoApplicationError(page);
    }
  });

  base("support admin can read companies and leads but cannot use CRM management controls", async ({ page }) => {
    await loginAs(page, "support-admin@alpha-os.test");
    await page.goto("/admin/crm/companies");
    await expect(page.getByRole("heading", { name: "Companies", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "New company", exact: true })).toHaveCount(0);
    await page.goto("/admin/crm/leads");
    await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "New lead", exact: true })).toHaveCount(0);
    const { companyId, leadId } = await seededCrmIds();
    await page.goto(`/admin/crm/companies/${companyId}`);
    await expect(page.getByRole("button", { name: "Archive" })).toHaveCount(0);
    await page.goto(`/admin/crm/leads/${leadId}`);
    await expect(page.getByRole("button", { name: /Mark |Disqualify/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Complete task" })).toHaveCount(0);
  });
});

base.describe("CRM — real sales workflow", () => {
  base("platform admin creates and works a company, contact, lead, activities, statuses, and task", async ({ page }) => {
    const uniqueId = `${Date.now()}`;
    const companyName = `[${uniqueId}] E2E Company <img src=x onerror="window.__crmXss=1">`;
    const contactName = `Taylor ${uniqueId}`;
    const leadTitle = `[${uniqueId}] E2E conversion lead`;
    const note = `E2E note ${uniqueId}`;
    const callNote = `E2E call ${uniqueId}`;
    const taskTitle = `[${uniqueId}] E2E follow-up`;

    await loginAs(page, "platform-admin@alpha-os.test");
    await page.goto("/admin/crm/companies");
    await page.getByLabel("Name").fill(companyName);
    await page.getByLabel("Domain (optional)").fill(`e2e-${uniqueId}.example`);
    await page.getByRole("button", { name: "Create company" }).click();
    // Not `exact: true` here — the company row's link wraps BOTH its
    // name and its domain (`companies/page.tsx`), so its full accessible
    // name is "companyName domain", not the bare name alone; Playwright's
    // default (non-exact) matching is a normalized substring match,
    // which still targets this one row unambiguously.
    await expect(page.getByRole("link", { name: companyName })).toBeVisible();
    await page.getByRole("link", { name: companyName }).click();
    await expect(page.getByRole("heading", { name: companyName, exact: true })).toBeVisible();
    await expect(page.locator('main img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(window, "__crmXss"))).toBeUndefined();

    await page.getByLabel("First name").fill("Taylor");
    await page.getByLabel("Last name").fill(uniqueId);
    await page.getByLabel("Email (optional)").fill(`taylor-${uniqueId}@example.test`);
    await page.getByRole("button", { name: "Add contact" }).click();
    // Same reasoning as the company row above — this row's link wraps
    // the contact's name AND its job title/email.
    await expect(page.getByRole("link", { name: contactName })).toBeVisible();
    await page.getByRole("link", { name: contactName }).click();
    await expect(page.getByRole("heading", { name: contactName, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: companyName, exact: true })).toBeVisible();

    await page.goto("/admin/crm/leads");
    await page.getByLabel("Title").fill(leadTitle);
    await choose(page, "Company", companyName);
    await page.getByRole("button", { name: "Create lead" }).click();
    await expect(page.getByRole("link", { name: leadTitle, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: leadTitle, exact: true }).locator("xpath=ancestor::tr")).toContainText("NEW");
    await page.getByRole("link", { name: leadTitle, exact: true }).click();
    await expect(page.getByRole("heading", { name: leadTitle, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: companyName, exact: true })).toBeVisible();

    await page.getByLabel("Notes").fill(note);
    await page.getByRole("button", { name: "Log activity" }).click();
    await expect(page.getByText(note, { exact: true })).toBeVisible();
    await choose(page, "Type", "Call");
    await choose(page, "Outcome", "Connected");
    await page.getByLabel("Duration (min)").fill("12");
    await page.getByLabel("Notes").fill(callNote);
    await page.getByRole("button", { name: "Log activity" }).click();
    await expect(page.getByText(callNote, { exact: true })).toBeVisible();
    await expect(page.getByText(/logged a call \(connected, 12 min\)/)).toBeVisible();

    for (const [button, status] of [["Mark contacted", "CONTACTED"], ["Mark qualified", "QUALIFIED"], ["Mark converted", "CONVERTED"]] as const) {
      const statusChanges = await page.getByText("changed status", { exact: false }).count();
      await page.getByRole("button", { name: button }).click();
      await expect(page.getByText(status, { exact: true }).first()).toBeVisible();
      await expect.poll(() => page.getByText("changed status", { exact: false }).count()).toBeGreaterThan(statusChanges);
    }

    await page.getByLabel("Follow-up task").fill(taskTitle);
    await page.getByLabel("Due date").fill("2030-01-15");
    await choose(page, "Assign to", "Platform Owner (Dev)");
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(page.getByText(taskTitle, { exact: true })).toBeVisible();
    await page.goto("/admin/crm/tasks?assignee=everyone&status=OPEN");
    const openTaskCard = page.getByText(taskTitle, { exact: true }).locator("xpath=ancestor::div[@data-slot='card']");
    await expect(openTaskCard).toBeVisible();
    await openTaskCard.getByRole("button", { name: "Complete task" }).click();
    // This view is filtered to `status=OPEN` — once the completion
    // commits and the page refreshes, the row correctly DISAPPEARS from
    // this exact filter (it's no longer OPEN), rather than lingering
    // with an updated badge. Confirm it moved to the COMPLETED filter
    // instead of asserting a state this filtered view would never show.
    await expect(page.getByText(taskTitle, { exact: true })).toHaveCount(0);
    await page.goto("/admin/crm/tasks?assignee=everyone&status=COMPLETED");
    const completedTaskCard = page.getByText(taskTitle, { exact: true }).locator("xpath=ancestor::div[@data-slot='card']");
    await expect(completedTaskCard).toContainText("COMPLETED");
    await expect(completedTaskCard.getByRole("button", { name: /Complete task|Cancel task/ })).toHaveCount(0);
  });

  base("platform admin must provide a disqualification reason", async ({ page }) => {
    const uniqueId = `${Date.now()}`;
    const title = `[${uniqueId}] E2E disqualification lead`;
    const reason = `E2E reason ${uniqueId}`;
    await loginAs(page, "platform-admin@alpha-os.test");
    await page.goto("/admin/crm/leads");
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create lead" }).click();
    await page.getByRole("link", { name: title, exact: true }).click();
    await page.getByRole("button", { name: "Mark contacted" }).click();
    await expect(page.getByText("CONTACTED", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Disqualify" }).click();
    await expect(page.getByRole("button", { name: "Confirm disqualify" })).toBeDisabled();
    await page.getByLabel("Reason").fill(reason);
    await page.getByRole("button", { name: "Confirm disqualify" }).click();
    await expect(page.getByText("DISQUALIFIED", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(reason, { exact: true })).toBeVisible();
  });
});

base.describe("CRM — settings, not found, and responsive behavior", () => {
  base("platform admin creates lead sources and company custom fields", async ({ page }) => {
    const uniqueId = `${Date.now()}`;
    const source = `[${uniqueId}] E2E Source`;
    const textLabel = `[${uniqueId}] E2E Text field`;
    const selectLabel = `[${uniqueId}] E2E Select field`;
    const options = ["Small", "Medium", "Large"];
    await loginAs(page, "platform-admin@alpha-os.test");
    await page.goto("/admin/crm/settings");
    await page.getByLabel("New lead source").fill(source);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(source, { exact: true })).toBeVisible();

    const companyFields = page.getByRole("heading", { name: "Company custom fields" }).locator("xpath=ancestor::section");
    await companyFields.getByLabel("Label").fill(textLabel);
    await companyFields.getByLabel("Key (lower_snake_case)").fill(`e2e_text_${uniqueId}`);
    await companyFields.getByRole("button", { name: "Add field" }).click();
    await expect(companyFields.getByText(textLabel, { exact: true })).toBeVisible();

    await companyFields.getByLabel("Label").fill(selectLabel);
    await companyFields.getByLabel("Key (lower_snake_case)").fill(`e2e_select_${uniqueId}`);
    await choose(companyFields, "Type", "Select (comma-separated options)");
    await companyFields.getByLabel("Options").fill(options.join(", "));
    await companyFields.getByRole("button", { name: "Add field" }).click();
    // Scoped to this field's own card, not the whole section — repeated
    // runs against a persistent dev database accumulate multiple SELECT
    // fields that happen to share these same generic option words, so an
    // unscoped `companyFields.getByText("Small", ...)` would match every
    // one of them, not just the field this run just created.
    const selectFieldCard = companyFields.getByText(selectLabel, { exact: true }).locator("xpath=ancestor::div[@data-slot='card']");
    await expect(selectFieldCard).toBeVisible();
    for (const option of options) await expect(selectFieldCard.getByText(option, { exact: true })).toBeVisible();

    await page.goto("/admin/crm/leads");
    await page.getByLabel("Source (optional)").click();
    await expect(page.getByRole("option", { name: source, exact: true })).toBeVisible();
  });

  base("nonexistent CRM company and lead show not-found pages without application errors", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    for (const path of [`/admin/crm/companies/${MISSING_ID}`, `/admin/crm/leads/${MISSING_ID}`]) {
      await page.goto(path);
      await expect(page.getByText("404")).toBeVisible();
      await expectNoApplicationError(page);
    }
  });

  base("CRM stays functional at mobile and tablet widths", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      for (const path of ["/admin/crm", "/admin/crm/companies"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { name: path.endsWith("companies") ? "Companies" : "CRM", exact: true })).toBeVisible();
        await expectNoApplicationError(page);
        await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBeTruthy();
      }
    }
  });
});
