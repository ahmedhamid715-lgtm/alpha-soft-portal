import { test as base, expect } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Module 06 (Multi-Tenancy & RLS) E2E — real browser, real running app,
 * real database, no mocked authorization (spec section 50). Uses
 * `prisma/seed-rbac.ts`'s fixtures: Org A ("Acme Corp"), Org B ("Beta
 * Industries"), and `multiorg@alpha-os.test` (admin in A, viewer in B).
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);
});

const PASSWORD = "alpha-os-dev-password";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://ahmed@localhost:5432/alpha_os_dev";

async function loginAs(page: import("@playwright/test").Page, email: string) {
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

base.describe("Organization selection & switching (spec section 8/36)", () => {
  base("lists every organization a multi-org user belongs to, with correct roles", async ({ page }) => {
    await loginAs(page, "multiorg@alpha-os.test");
    await page.goto("/organizations");
    await expect(page.locator("body")).toContainText("Acme Corp");
    await expect(page.locator("body")).toContainText("Beta Industries");
    await expect(page.locator("body")).toContainText("admin");
    await expect(page.locator("body")).toContainText("viewer");
  });

  // multiorg@alpha-os.test is seeded (spec section 23's exact example) as
  // `admin` in Acme Corp but only `viewer` in Beta Industries — admin
  // holds `roles.read`, viewer does not (see `lib/authorization/roles.ts`'s
  // catalog). So switching to Beta Industries correctly shows a denial,
  // not Beta's member list — proving both organization scoping (which
  // org's data) AND role scoping (what this specific role may see in
  // that org) survive a switch, not just the former. An earlier version
  // of this test asserted Beta's member data was visible after
  // switching there, which was simply the wrong expectation for a
  // viewer, not a real bug.
  base("switching organizations changes both which organization's data is visible AND which permissions apply", async ({ page }) => {
    await loginAs(page, "multiorg@alpha-os.test");

    // Switch to Acme Corp (Org A), where multiorg is admin — full access.
    await page.goto("/organizations");
    const acmeRow = page.locator("tr", { hasText: "Acme Corp" });
    // `waitForURL("**/organizations")` would be a no-op here — we're
    // already on that URL, so it resolves immediately without actually
    // waiting for the switch Server Action's own navigation/redirect to
    // finish, racing the next `page.goto()` ahead of the cookie being
    // set (found by an earlier version of this exact test, which then
    // legitimately failed — not an application bug, a test
    // synchronization bug). `networkidle` waits for the real round trip.
    await acmeRow.getByRole("button", { name: /switch/i }).click();
    await page.waitForLoadState("networkidle");

    await page.goto("/admin/roles");
    await expect(page.locator("body")).toContainText("owner-a@alpha-os.test");
    await expect(page.locator("body")).not.toContainText("owner-b@alpha-os.test");

    // Now switch to Beta Industries (Org B), where multiorg is only viewer.
    await page.goto("/organizations");
    const betaRow = page.locator("tr", { hasText: "Beta Industries" });
    await betaRow.getByRole("button", { name: /switch/i }).click();
    await page.waitForLoadState("networkidle");

    await page.goto("/admin/roles");
    await expect(page.locator("body")).toContainText("don't have access");
    await expect(page.locator("body")).not.toContainText("owner-a@alpha-os.test");
    await expect(page.locator("body")).not.toContainText("owner-b@alpha-os.test");
  });

  base("browser back navigation after switching still enforces the real current context, not a stale cached view", async ({ page }) => {
    await loginAs(page, "multiorg@alpha-os.test");
    await page.goto("/organizations");

    const acmeRow = page.locator("tr", { hasText: "Acme Corp" });
    // `waitForURL("**/organizations")` would be a no-op here — we're
    // already on that URL, so it resolves immediately without actually
    // waiting for the switch Server Action's own navigation/redirect to
    // finish, racing the next `page.goto()` ahead of the cookie being
    // set (found by an earlier version of this exact test, which then
    // legitimately failed — not an application bug, a test
    // synchronization bug). `networkidle` waits for the real round trip.
    await acmeRow.getByRole("button", { name: /switch/i }).click();
    await page.waitForLoadState("networkidle");
    await page.goto("/admin/roles");
    await expect(page.locator("body")).toContainText("owner-a@alpha-os.test");

    await page.goto("/organizations");
    const betaRow = page.locator("tr", { hasText: "Beta Industries" });
    await betaRow.getByRole("button", { name: /switch/i }).click();
    await page.waitForLoadState("networkidle");

    // Navigate to /admin/roles fresh (not via cached back-button state) —
    // Server Components re-render from the server on every navigation,
    // so this always reflects the CURRENT cookie, never a client-cached
    // snapshot of Org A's data. multiorg is only `viewer` in Org B (no
    // roles.read), so the correct outcome is a denial, not Org B's data —
    // the point being that it's neither a stale view of Org A NOR an
    // accidental full view of Org B, but the exact correct permission
    // for who they are in whichever org is now current.
    await page.goto("/admin/roles");
    await expect(page.locator("body")).toContainText("don't have access");
    await expect(page.locator("body")).not.toContainText("owner-a@alpha-os.test");
  });

  base("cannot switch into an organization the user does not belong to by forging the form's organizationId", async ({ page }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto("/organizations");

    // Forge Acme Corp's own row's hidden organizationId field to Org B's
    // id (owner-a does not belong to Org B) and submit THAT row's form —
    // scoped specifically to it, not `button[type=submit]` page-wide,
    // which would match the shared header's "Sign out" button first
    // (found by an earlier version of this exact test, which then
    // "passed" for the wrong reason: it had logged the user out, not
    // exercised the forgery attempt at all).
    const orgBId = await withPgClient((client) =>
      client.query("SELECT id FROM organizations WHERE slug = 'beta-industries-dev'").then((r) => r.rows[0].id as string),
    );
    const acmeRow = page.locator("tr", { hasText: "Acme Corp" });
    await acmeRow.evaluate((row, id) => {
      const input = row.querySelector<HTMLInputElement>('input[name="organizationId"]');
      if (input) input.value = id;
    }, orgBId);
    await acmeRow.locator('button[type="submit"]').click();

    await expect(page.locator("body")).toContainText(/not.*active member|not currently active/i);
  });
});

base.describe("Cross-tenant IDOR via the real UI (spec sections 18/19)", () => {
  base("Org A's owner cannot see Org B's members on /admin/roles regardless of navigation path", async ({ page }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto("/admin/roles");
    await expect(page.locator("body")).not.toContainText("owner-b@alpha-os.test");
    await expect(page.locator("body")).not.toContainText("member-b@alpha-os.test");
  });
});

base.describe("Suspended / archived organization handling (spec sections 21/36)", () => {
  base("a SUSPENDED organization's member cannot switch into it, and it disappears from normal access", async ({ page }) => {
    const orgId = await withPgClient(async (client) => {
      const result = await client.query("SELECT id FROM organizations WHERE slug = 'beta-industries-dev'");
      const id = result.rows[0].id as string;
      await client.query("UPDATE organizations SET status = 'SUSPENDED' WHERE id = $1", [id]);
      return id;
    });

    try {
      await loginAs(page, "owner-b@alpha-os.test");
      await page.goto("/organizations");
      const betaRow = page.locator("tr", { hasText: "Beta Industries" });
      await expect(betaRow.getByRole("button", { name: /switch/i })).toBeDisabled();

      // /admin/roles must not resolve Org B's context anymore, even though owner-b's membership row itself is untouched.
      await page.goto("/admin/roles");
      await expect(page.locator("body")).toContainText("don't have access");
    } finally {
      await withPgClient((client) => client.query("UPDATE organizations SET status = 'ACTIVE' WHERE id = $1", [orgId]));
    }
  });
});

base.describe("Membership revocation (spec section 22) — real browser, no logout required", () => {
  base("removing a membership mid-session blocks organization access on the very next request", async ({ page }) => {
    await loginAs(page, "customer-a@alpha-os.test");
    await page.goto("/organizations");
    await expect(page.locator("body")).toContainText("Acme Corp");

    const original = await withPgClient((client) =>
      client
        .query(
          "SELECT m.id, m.organization_id, m.user_id, m.role, m.role_id FROM organization_memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'customer-a@alpha-os.test'",
        )
        .then((r) => r.rows[0] as { id: string; organization_id: string; user_id: string; role: string; role_id: string | null }),
    );

    try {
      await withPgClient((client) => client.query("DELETE FROM organization_memberships WHERE id = $1", [original.id]));

      await page.goto("/organizations");
      await expect(page.locator("body")).not.toContainText("Acme Corp");
    } finally {
      // Restore the exact original row for any later test run against the same seeded database.
      await withPgClient((client) =>
        client.query(
          `INSERT INTO organization_memberships (id, organization_id, user_id, role, role_id, status, joined_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', now(), now(), now())
           ON CONFLICT (id) DO NOTHING`,
          [original.id, original.organization_id, original.user_id, original.role, original.role_id],
        ),
      );
    }
  });
});
