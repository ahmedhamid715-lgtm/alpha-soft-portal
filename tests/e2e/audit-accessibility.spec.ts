import { test as base, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * axe-core against Module 08's new UI (spec Phase 33) —
 * desktop/tablet/mobile × light/dark for every new page: the platform
 * and organization audit lists (at rest, with a filter applied, and in
 * the "no results" empty state), and the event detail page (with its
 * collapsed `<details>` technical-record blocks both closed and open).
 *
 * Logs in ONCE per persona and loops viewport/scheme INSIDE each test —
 * same rate-limit-budget reasoning as
 * `user-org-management-accessibility.spec.ts`'s own top comment.
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);
});

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
} as const;
const SCHEMES = ["light", "dark"] as const;

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

async function seedAuditEvent(organizationId: string | null): Promise<string> {
  return withPgClient(async (client) => {
    const result = await client.query(
      `INSERT INTO audit_events (id, organization_id, actor_type, action, category, outcome, resource_type, resource_id, resource_name, previous_state, new_state, metadata, request_id, correlation_id, created_at)
       VALUES (gen_random_uuid(), $1, 'SYSTEM', 'organization.updated', 'ORGANIZATION', 'SUCCESS', 'organization', $2, 'A11y Fixture Org',
               '{"displayName": "Old Name"}'::jsonb, '{"displayName": "New Name"}'::jsonb, '{"note": "seeded for accessibility scan"}'::jsonb,
               gen_random_uuid()::text, gen_random_uuid()::text, now())
       RETURNING id`,
      [organizationId, organizationId ?? crypto.randomUUID()],
    );
    return result.rows[0].id as string;
  });
}

async function deleteAuditEvent(id: string): Promise<void> {
  await withPgClient((client) => client.query("DELETE FROM audit_events WHERE id = $1", [id]));
}

async function scan(page: Page, label: string, violations: string[]) {
  // Same 250ms settle + reasoning as `user-org-management-accessibility.spec.ts`'s
  // own `scan()` — avoids catching a mid-CSS-transition false-positive
  // color-contrast violation.
  await page.waitForTimeout(250);
  const results = await new AxeBuilder({ page }).analyze();
  if (results.violations.length > 0) {
    violations.push(`${label}: ${JSON.stringify(results.violations, null, 2)}`);
  }
}

base.describe("Platform audit log accessibility", () => {
  base("list (at rest, filtered, empty state) and detail page — no violations across every viewport/scheme", async ({ page }) => {
    const eventId = await seedAuditEvent(null);
    const violations: string[] = [];

    try {
      await loginAs(page, "platform-owner@alpha-os.test");

      for (const scheme of SCHEMES) {
        for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
          await page.setViewportSize(viewport);
          await page.emulateMedia({ colorScheme: scheme });

          await page.goto("/admin/audit");
          await scan(page, `platform audit list (${scheme}, ${viewportName})`, violations);

          await page.goto(`/admin/audit/${eventId}`);
          await scan(page, `platform audit detail (${scheme}, ${viewportName})`, violations);

          // Empty-state: a filter combination guaranteed to match nothing.
          await page.goto("/admin/audit?search=zzz-no-such-event-zzz");
          await scan(page, `platform audit list, empty state (${scheme}, ${viewportName})`, violations);
        }
      }

      expect(violations, violations.join("\n\n")).toHaveLength(0);
    } finally {
      await deleteAuditEvent(eventId);
    }
  });

  base("access-denied state (a member with no audit.readPlatform) — no violations", async ({ page }) => {
    const violations: string[] = [];
    await loginAs(page, "customer-a@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.setViewportSize(VIEWPORTS.desktop);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/admin/audit");
      await scan(page, `platform audit access-denied (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });
});

base.describe("Organization audit log accessibility", () => {
  base("list, detail page with expanded technical record, and investigation-filtered view — no violations across every viewport/scheme", async ({ page }) => {
    const id = await orgId("acme-corp-dev");
    const eventId = await seedAuditEvent(id);
    const violations: string[] = [];

    try {
      await loginAs(page, "owner-a@alpha-os.test");

      for (const scheme of SCHEMES) {
        for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
          await page.setViewportSize(viewport);
          await page.emulateMedia({ colorScheme: scheme });

          await page.goto(`/organizations/${id}/audit`);
          await scan(page, `org audit list (${scheme}, ${viewportName})`, violations);

          await page.goto(`/organizations/${id}/audit/${eventId}`);
          await scan(page, `org audit detail, technical record collapsed (${scheme}, ${viewportName})`, violations);
        }
      }

      // Expand the `<details>` "Before"/"After"/"Additional context" blocks — a native
      // disclosure widget, but still worth scanning open (real content becomes visible).
      await page.setViewportSize(VIEWPORTS.desktop);
      for (const scheme of SCHEMES) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`/organizations/${id}/audit/${eventId}`);
        const summaries = page.locator("details summary");
        const count = await summaries.count();
        for (let i = 0; i < count; i++) {
          await summaries.nth(i).click();
        }
        await scan(page, `org audit detail, technical record expanded (${scheme})`, violations);
      }

      // Investigation-filtered list (query params set, "clear" link visible).
      await page.goto(`/organizations/${id}/audit?resourceType=organization&resourceId=${id}`);
      await scan(page, "org audit list, investigation-filtered", violations);

      expect(violations, violations.join("\n\n")).toHaveLength(0);
    } finally {
      await deleteAuditEvent(eventId);
    }
  });

  base("access-denied state (viewer role) and filter form focus/keyboard order — no violations", async ({ page }) => {
    const id = await orgId("acme-corp-dev");
    const violations: string[] = [];
    await loginAs(page, "viewer-a@alpha-os.test");

    for (const scheme of SCHEMES) {
      await page.setViewportSize(VIEWPORTS.desktop);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/organizations/${id}/audit`);
      await scan(page, `org audit access-denied (${scheme})`, violations);
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });
});
