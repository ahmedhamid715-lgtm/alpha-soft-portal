import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Module 08 adversarial security tests (spec Phase 29/30) — the audit
 * system's own attack surface: cross-organization IDOR on the list and
 * detail pages, platform-scope containment (a platform admin must never
 * see a customer organization's own audit trail through `/admin/audit`,
 * regardless of what a client sends), unauthenticated access, and
 * export-endpoint authorization. Real browser, real running app, real
 * database.
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

async function seedOrgAuditEvent(organizationId: string, action = "organization.updated"): Promise<string> {
  return withPgClient(async (client) => {
    const result = await client.query(
      `INSERT INTO audit_events (id, organization_id, actor_type, action, category, outcome, resource_type, resource_id, resource_name, request_id, correlation_id, created_at)
       VALUES (gen_random_uuid(), $1, 'SYSTEM', $2, 'ORGANIZATION', 'SUCCESS', 'organization', $1, 'Security Fixture Resource', gen_random_uuid()::text, gen_random_uuid()::text, now())
       RETURNING id`,
      [organizationId, action],
    );
    return result.rows[0].id as string;
  });
}

async function deleteAuditEvent(id: string): Promise<void> {
  await withPgClient((client) => client.query("DELETE FROM audit_events WHERE id = $1", [id]));
}

base.describe("Unauthenticated access", () => {
  base("visiting the platform or an organization audit log while signed out redirects to /login", async ({ page }) => {
    const id = await orgId("acme-corp-dev");

    await page.goto("/admin/audit");
    await expect(page).toHaveURL(/\/login/);

    await page.goto(`/organizations/${id}/audit`);
    await expect(page).toHaveURL(/\/login/);
  });

  base("the CSV export endpoints reject an unauthenticated request", async ({ page }) => {
    const id = await orgId("acme-corp-dev");
    const platformExport = await page.request.get("/admin/audit/export", { maxRedirects: 0 }).catch((e) => e);
    const orgExport = await page.request.get(`/organizations/${id}/audit/export`, { maxRedirects: 0 }).catch((e) => e);
    // Either a redirect-to-login or a JSON 401 — never a 200 with CSV content.
    for (const resp of [platformExport, orgExport]) {
      if ("status" in resp) {
        expect(resp.status()).not.toBe(200);
      }
    }
  });
});

base.describe("Cross-organization IDOR", () => {
  base("an Org A owner cannot view Org B's audit log by navigating directly to its URL", async ({ page }) => {
    const orgAId = await orgId("acme-corp-dev");
    const orgBId = await orgId("beta-industries-dev");

    await loginAs(page, "owner-a@alpha-os.test");

    // Sanity: owner-a genuinely has access to their own org.
    await page.goto(`/organizations/${orgAId}/audit`);
    await expect(page.locator("body")).not.toContainText("don't have access");

    // The actual test: Org B, a real organization owner-a is not a member of.
    await page.goto(`/organizations/${orgBId}/audit`);
    await expect(page.locator("body")).toContainText("don't have access");
    await expect(page.locator("table")).toHaveCount(0);
  });

  base("an Org A owner cannot view a specific Org B audit event by guessing its detail URL, even under Org A's own path prefix", async ({ page }) => {
    const orgAId = await orgId("acme-corp-dev");
    const orgBId = await orgId("beta-industries-dev");
    const orgBEventId = await seedOrgAuditEvent(orgBId);

    try {
      await loginAs(page, "owner-a@alpha-os.test");

      // Attempt 1: Org B's own detail path — owner-a has no audit.read there at all.
      const resp1 = await page.goto(`/organizations/${orgBId}/audit/${orgBEventId}`);
      expect(resp1?.status()).toBeLessThan(500);
      await expect(page.locator("body")).toContainText("don't have access");

      // Attempt 2: the more dangerous shape — Org B's real event id spliced
      // under Org A's OWN path prefix (owner-a DOES hold audit.read there).
      // The route must still 404 (organizationId mismatch check —
      // `event.organizationId !== id` in the page itself), not render
      // Org B's data just because the URL's org segment matches a
      // permission the caller actually holds.
      const resp2 = await page.goto(`/organizations/${orgAId}/audit/${orgBEventId}`);
      expect(resp2?.status()).toBe(404);
    } finally {
      await deleteAuditEvent(orgBEventId);
    }
  });

  base("appending a foreign organizationId as a query parameter does not override the URL path's own organization scope", async ({ page }) => {
    const orgAId = await orgId("acme-corp-dev");
    const orgBId = await orgId("beta-industries-dev");
    const orgBEventId = await seedOrgAuditEvent(orgBId, "organization.suspended");

    try {
      await loginAs(page, "owner-a@alpha-os.test");
      await page.goto(`/organizations/${orgAId}/audit?organizationId=${orgBId}`);
      await expect(page.locator("body")).not.toContainText("don't have access");
      await expect(page.locator("table")).not.toContainText("Security Fixture Resource");
    } finally {
      await deleteAuditEvent(orgBEventId);
    }
  });
});

base.describe("Platform-scope containment", () => {
  base("a platform admin's /admin/audit never shows a real customer organization's own audit event, even one that exists", async ({ page }) => {
    const orgAId = await orgId("acme-corp-dev");
    // A unique marker in `resourceName`, not the bare `action` string —
    // `action` alone ("organization.archived") can collide with an
    // unrelated, legitimately-visible event created by something else
    // entirely (this dev database is shared with the Vitest integration
    // suite, whose own fixtures can leave real rows with the same
    // action). `resourceName` is never redacted/deduped and is unique to
    // THIS fixture, so a false negative here can't hide a real leak.
    const customerEventId = await seedOrgAuditEvent(orgAId, "organization.archived");

    try {
      await loginAs(page, "support-admin@alpha-os.test");
      await page.goto("/admin/audit");
      await expect(page.locator("body")).not.toContainText("don't have access");
      await expect(page.locator("table")).not.toContainText("Security Fixture Resource");

      // Guessing the real customer event's id directly under /admin/audit/ must 404, not render it.
      const resp = await page.goto(`/admin/audit/${customerEventId}`);
      expect(resp?.status()).toBe(404);
    } finally {
      await deleteAuditEvent(customerEventId);
    }
  });

  base("support-admin holds audit.readPlatform but not audit.exportPlatform — the export link is absent and the endpoint itself rejects the request", async ({ page }) => {
    await loginAs(page, "support-admin@alpha-os.test");
    await page.goto("/admin/audit");
    await expect(page.getByRole("link", { name: "Export CSV" })).toHaveCount(0);

    const resp = await page.request.get("/admin/audit/export");
    expect(resp.status()).toBe(403);
    const body = await resp.json();
    expect(body.error.code).toBe("AUTHORIZATION_ERROR");
  });
});

base.describe("Export endpoint authorization (direct request, bypassing the UI entirely)", () => {
  base("an org member without audit.export gets 403 JSON, never CSV content, from the export endpoint directly", async ({ page }) => {
    const orgAId = await orgId("acme-corp-dev");
    await loginAs(page, "member-a@alpha-os.test");

    const resp = await page.request.get(`/organizations/${orgAId}/audit/export`);
    expect(resp.status()).toBe(403);
    expect(resp.headers()["content-type"]).not.toContain("text/csv");
    const body = await resp.json();
    expect(body.error.code).toBe("AUTHORIZATION_ERROR");
  });

  base("an org member cannot export a DIFFERENT organization's audit log by editing the export URL's id", async ({ page }) => {
    const orgAId = await orgId("acme-corp-dev");
    const orgBId = await orgId("beta-industries-dev");
    await loginAs(page, "admin-a@alpha-os.test");

    // Sanity: admin-a can export their own org.
    const own = await page.request.get(`/organizations/${orgAId}/audit/export`);
    expect(own.status()).toBe(200);

    // The actual test.
    const foreign = await page.request.get(`/organizations/${orgBId}/audit/export`);
    expect(foreign.status()).toBe(403);
  });
});
