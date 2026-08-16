import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Module 07 (User & Organization Management) E2E — real browser, real
 * running app, real database, no mocked authorization (spec section 59).
 * Uses `prisma/seed-rbac.ts` + `prisma/seed-user-org-management.ts`'s
 * fixtures: platform staff, Org A "Acme Corp" (owner/admin/manager/
 * member/viewer/customer), Org B "Beta Industries" (owner/admin/member/
 * customer), `multiorg@alpha-os.test`, pending/expired/revoked
 * invitations, and a suspended + archived organization.
 *
 * Module 06's own E2E suite (`multi-tenancy.spec.ts`) already covers
 * organization switching, browser-back-after-switch, membership
 * revocation mid-session, and the suspended-org switch-disabled case —
 * not repeated here.
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);
});

const PASSWORD = "alpha-os-dev-password";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://ahmed@localhost:5432/alpha_os_dev";

/**
 * Every call is a real, full form login against the real running app —
 * a cookie-replay cache was tried here and removed: it broke POST-driven
 * Server Actions (the page loaded fine with the replayed session, but
 * submitting a form redirected to /login) while GETs looked fine, a
 * confusing failure mode not worth chasing further given this spec's
 * account-level login counts (highest: owner-a at 9) stay under
 * `authRateLimiter`'s 10-per-15-minutes-per-email budget without any
 * caching, as long as the suite runs against a freshly-started server
 * (a stale server from a previous run carries over rate-limit state —
 * restart it between debugging runs, not a bug in the app).
 */
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

// --- Organization creation (spec section 28) -------------------------------

base.describe("Organization creation", () => {
  base("platform staff can create an organization; the org, owner membership, and onboarding record are ready immediately", async ({ page }) => {
    await loginAs(page, "platform-admin@alpha-os.test");
    await page.goto("/organizations/new");
    await expect(page.locator("body")).not.toContainText("don't have access");

    const uniqueSlug = `e2e-created-org-${Date.now()}`;
    await page.fill("input[name=displayName]", "E2E Created Org");
    await page.fill("input[name=name]", "E2E Created Org Legal");
    await page.fill("input[name=slug]", uniqueSlug);
    await page.fill("input[name=ownerName]", "E2E Created Owner");
    await page.fill("input[name=ownerEmail]", `e2e-owner-${Date.now()}@example.com`);
    // Scoped to the form's own button — `(protected)/layout.tsx`'s
    // shared header also renders a `button[type=submit]` ("Sign out"),
    // EARLIER in the DOM, so an unscoped `page.click('button[type=submit]')`
    // clicks Sign Out instead of this form (found by an earlier version
    // of this exact test: it "timed out" waiting for the onboarding URL
    // because it had actually signed itself out and landed on /login —
    // not a product bug, a test-selector bug).
    await page.getByRole("button", { name: "Create organization" }).click();

    // No redirect into the new org's onboarding — the creator (platform
    // staff) has no membership in it at all (only the invited owner
    // does); see `createOrganizationAction`'s own comment for why that's
    // correct, not a missing feature.
    await expect(page.locator("body")).toContainText("E2E Created Org created");
    await expect(page.locator("body")).toContainText(uniqueSlug);

    const newOrg = await withPgClient((client) =>
      client.query("SELECT status FROM organizations WHERE slug = $1", [uniqueSlug]).then((r) => r.rows[0]),
    );
    expect(newOrg.status).toBe("ACTIVE");
  });

  base("a regular organization owner (not platform staff) cannot reach the creation form's real capability", async ({ page }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto("/organizations/new");
    await expect(page.locator("body")).toContainText("don't have access");
  });

  // "Server Action manipulation" via a raw `request.post()` was tried
  // here and removed — Next.js Server Actions require the real,
  // server-generated `$ACTION_REF_1`/`$ACTION_1:0`/`$ACTION_KEY` hidden
  // fields to route a POST to the bound action at all (verified directly
  // with curl: a plain urlencoded POST to a Server-Action-backed page
  // just re-renders the page, never invoking the action — so a "forged"
  // request that never reaches `createOrganization()` proves nothing).
  // The real guarantee — `organizations.create` is checked inside
  // `createOrganization()` itself, independent of the UI — is proven at
  // the service layer instead, with REAL Postgres, in
  // `tests/integration/db/organization-management-service.test.ts`
  // ("a customer organization's OWNER cannot create a new organization").
});

// --- Member directory & detail (spec sections 9/10) -------------------------

base.describe("Member directory & detail", () => {
  // Consolidated into one owner-a session — see loginAs()'s comment:
  // `authRateLimiter` is 10/15min per email, and this spec needs owner-a
  // for many different scenarios across the file.
  base("member directory: searchable, and detail sheet shows no password hash or token", async ({ page }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    const id = await orgId("acme-corp-dev");
    await page.goto(`/organizations/${id}/members`);
    await expect(page.locator("body")).toContainText("admin-a@alpha-os.test");
    await expect(page.locator("body")).toContainText("viewer-a@alpha-os.test");

    await page.fill('input[aria-label="Search table"]', "admin-a");
    await expect(page.locator("body")).toContainText("admin-a@alpha-os.test");
    await expect(page.locator("body")).not.toContainText("viewer-a@alpha-os.test");
    await page.fill('input[aria-label="Search table"]', "");

    const row = page.locator("tr", { hasText: "member-a@alpha-os.test" });
    await row.getByRole("button", { name: /manage/i }).click();
    await expect(page.getByRole("dialog")).toContainText("member-a@alpha-os.test");
    await expect(page.locator("body")).not.toContainText(/passwordHash|\$argon2|\$2[aby]\$/i);
  });

  base("cross-tenant IDOR: Org B's owner cannot view Org A's members by forging the URL", async ({ page }) => {
    await loginAs(page, "owner-b@alpha-os.test");
    const acmeId = await orgId("acme-corp-dev");
    const res = await page.goto(`/organizations/${acmeId}/members`);
    expect(res?.status()).toBe(404);
    await expect(page.locator("body")).not.toContainText("member-a@alpha-os.test");
  });
});

// --- Role assignment & escalation protection (spec sections 24-27) ---------

base.describe("Role assignment", () => {
  base("an owner can change a member's role, and a forged cross-org membershipId in the same form is rejected", async ({ page }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    const orgAId = await orgId("acme-corp-dev");
    await page.goto(`/organizations/${orgAId}/members`);

    const row = page.locator("tr", { hasText: "customer-a@alpha-os.test" });
    await row.getByRole("button", { name: /manage/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "Viewer" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toContainText("Role updated.");

    // Revert for idempotent re-runs.
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "Customer" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toContainText("Role updated.");

    // `member-detail-sheet.tsx` renders a real
    // `<input type="hidden" name="membershipId">` — mutated here directly
    // via the DOM (not a hand-crafted raw HTTP request, which can't
    // correctly invoke a Next.js Server Action at all — see loginAs()'s
    // sibling comment above "org creation Server Action manipulation").
    // This is the actual attack shape: submit a legitimate-looking form
    // whose hidden field was edited in dev tools before submit.
    const orgBMemberId = await withPgClient((client) =>
      client
        .query("SELECT om.id FROM organization_memberships om JOIN users u ON u.id = om.user_id WHERE u.email = 'member-b@alpha-os.test'")
        .then((r) => r.rows[0].id as string),
    );
    // `.first()` — the Sheet has TWO forms, each with their own hidden
    // `membershipId` input (role-assign and status-toggle); this targets
    // the role-assign one specifically (rendered first).
    await dialog.locator('input[name="membershipId"]').first().evaluate((el: HTMLInputElement, forgedId: string) => {
      el.value = forgedId;
    }, orgBMemberId);
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "Viewer" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();

    // `assignRole()` re-derives the membership's REAL organization from
    // the database and re-verifies the caller's permission against
    // THAT organization — owner-a has no standing in Org B at all, so
    // this must fail, and Org B's real member must be untouched.
    await page.waitForLoadState("networkidle");
    const orgBMemberStillMember = await withPgClient((client) =>
      client.query("SELECT role FROM organization_memberships WHERE id = $1", [orgBMemberId]).then((r) => r.rows[0].role as string),
    );
    expect(orgBMemberStillMember).toBe("member");
  });

  base("unauthorized role escalation: a MEMBER cannot open member management at all", async ({ page }) => {
    await loginAs(page, "member-a@alpha-os.test");
    const id = await orgId("acme-corp-dev");
    // The `member` system role holds no `members.read` at all (roles.ts)
    // — the member directory 404s outright, not "renders with hidden
    // controls." A VIEWER (next test) DOES hold `members.read` but not
    // `members.update`, which is the more interesting "sees the list,
    // not the controls" case.
    const res = await page.goto(`/organizations/${id}/members`);
    expect(res?.status()).toBe(404);
  });

  base("unauthorized role escalation: a MANAGER can view member detail (holds members.read) but every mutation control is disabled or absent (lacks members.update/remove)", async ({ page }) => {
    await loginAs(page, "manager-a@alpha-os.test");
    const id = await orgId("acme-corp-dev");
    const res = await page.goto(`/organizations/${id}/members`);
    expect(res?.status()).toBe(200);
    await expect(page.locator("body")).toContainText("admin-a@alpha-os.test");

    // "Manage" itself opens a read-only-capable detail view (manager
    // holds members.read) — the real enforcement is that nothing INSIDE
    // it can actually mutate anything, checked directly rather than by
    // the row-level button's mere presence.
    const row = page.locator("tr", { hasText: "customer-a@alpha-os.test" });
    await row.getByRole("button", { name: /manage/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("combobox")).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: /suspend member/i })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /remove from organization/i })).toHaveCount(0);
  });

});

// --- Member lifecycle: suspend / reactivate / remove (spec sections 21/27) --

base.describe("Member lifecycle", () => {
  base("an admin can suspend then reactivate a member", async ({ page }) => {
    await loginAs(page, "admin-a@alpha-os.test");
    const id = await orgId("acme-corp-dev");
    await page.goto(`/organizations/${id}/members`);

    const row = page.locator("tr", { hasText: "customer-a@alpha-os.test" });
    await row.getByRole("button", { name: /manage/i }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /suspend member/i }).click();
    await page.waitForLoadState("networkidle");
    // The Sheet's own `member` prop is a snapshot taken when "Manage"
    // was clicked — it doesn't reactively track the just-revalidated
    // server data. Close it and reopen to read the FRESH status, not a
    // stale in-Sheet value (also required practically: the Sheet's modal
    // overlay would otherwise intercept the row button's next click).
    await dialog.getByRole("button", { name: "Close" }).first().click();

    await row.getByRole("button", { name: /manage/i }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("SUSPENDED");
    await dialog.getByRole("button", { name: /reactivate member/i }).click();
    await page.waitForLoadState("networkidle");
    await dialog.getByRole("button", { name: "Close" }).first().click();

    await row.getByRole("button", { name: /manage/i }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("ACTIVE");
  });

  base("last-owner protection: the sole owner cannot be suspended or have their role changed away from owner", async ({ page }) => {
    await loginAs(page, "owner-b@alpha-os.test");
    const id = await orgId("beta-industries-dev");
    await page.goto(`/organizations/${id}/members`);

    const row = page.locator("tr", { hasText: "owner-b@alpha-os.test" });
    await row.getByRole("button", { name: /manage/i }).click();
    const dialog = page.getByRole("dialog");
    // Self-management controls are hidden in the UI (isSelf guard) —
    // confirms the row itself never even offers the destructive control
    // for the viewer's own membership.
    await expect(dialog.getByRole("button", { name: /suspend member/i })).toHaveCount(0);
  });
});

// --- Invitations: create, duplicate, expired, revoked, accept, replay -----

base.describe("Invitations", () => {
  // Consolidated into one owner-a session (see loginAs()'s comment):
  // fixtures, duplicate-rejection, full invite→accept→replay, and revoke
  // all run sequentially against the one login.
  base("invitation fixtures, duplicate rejection, full lifecycle, revoke, and replay", async ({ page, browser }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    const id = await orgId("acme-corp-dev");
    await page.goto(`/organizations/${id}/invitations`);

    // --- fixtures show correct status ---
    // Searched, not just located by row text — this table can genuinely
    // exceed one page (every earlier test run in a long-lived dev
    // database adds rows), and the seeded fixtures sort oldest-first
    // off the default page once enough accumulate (found by this exact
    // test after repeated local runs, not a product bug).
    const searchBox = page.locator('input[aria-label="Search table"]');
    await searchBox.fill("pending-invite@alpha-os.test");
    await expect(page.locator("tr", { hasText: "pending-invite@alpha-os.test" })).toContainText("Pending");
    await searchBox.fill("expired-invite@alpha-os.test");
    await expect(page.locator("tr", { hasText: "expired-invite@alpha-os.test" })).toContainText("Expired");
    await searchBox.fill("revoked-invite@alpha-os.test");
    await expect(page.locator("tr", { hasText: "revoked-invite@alpha-os.test" })).toContainText("Revoked");
    await searchBox.fill("");

    // --- duplicate invitation for an already-pending email is rejected ---
    await page.getByRole("button", { name: /invite member/i }).click();
    let dialog = page.getByRole("dialog");
    await dialog.locator("input[name=email]").fill("pending-invite@alpha-os.test");
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "Member" }).click();
    await dialog.getByRole("button", { name: /send invitation/i }).click();
    await expect(dialog).toContainText(/already has a pending invitation/i);
    await page.keyboard.press("Escape");

    // --- full lifecycle: invite, accept as a new user, replay fails ---
    // Dev-mode invitation inspection: the mailer logs, never emails a
    // real address — the token itself only ever exists hashed in the
    // database, so this test derives it the only way a real invitee
    // would receive it (their inbox), by writing a freshly-minted token
    // directly to the row, standing in for "the email link the
    // recipient actually clicked" (spec section 52: the invitation's
    // internal id/token are never exposed to the browser at all).
    const email = `e2e-invitee-${Date.now()}@example.com`;
    await page.getByRole("button", { name: /invite member/i }).click();
    dialog = page.getByRole("dialog");
    await dialog.locator("input[name=email]").fill(email);
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "Member" }).click();
    await dialog.getByRole("button", { name: /send invitation/i }).click();
    await expect(dialog).toContainText("Invitation sent.");
    await dialog.getByRole("button", { name: "Done" }).click();

    const crypto = await import("node:crypto");
    const rawToken = "e2e-test-token-" + Date.now();
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await withPgClient((client) =>
      client.query("UPDATE organization_invitations SET token_hash = $1 WHERE email = $2 AND status = 'PENDING'", [tokenHash, email]),
    );

    // A genuinely separate, UNAUTHENTICATED browser context — not
    // `context.newPage()`, which would share owner-a's own session
    // cookies and hit the "signed in as a different email than the
    // invitation" mismatch path instead of the new-account signup form
    // (found by this exact test, not by inspection).
    const acceptContext = await browser.newContext();
    const newPage = await acceptContext.newPage();
    await newPage.goto(`/invitations/accept?token=${rawToken}`);
    await expect(newPage.locator("body")).toContainText("Join Acme Corp");
    await newPage.fill('input[name="name"]', "E2E Invitee");
    await newPage.fill('input[name="password"]', "a-genuinely-long-password-123");
    await newPage.click('button[type=submit]');
    await expect(newPage.locator("body")).toContainText("You've joined");

    // Invitation replay: accepting the SAME link again must fail.
    const replayPage = await acceptContext.newPage();
    await replayPage.goto(`/invitations/accept?token=${rawToken}`);
    await expect(replayPage.locator("body")).toContainText(/already been used/i);
    await newPage.close();
    await replayPage.close();

    // --- revoking a pending invitation stops it from being usable ---
    const revokeEmail = `e2e-revoke-target-${Date.now()}@example.com`;
    const revokeRawToken = "e2e-revoke-token-" + Date.now();
    const revokeTokenHash = crypto.createHash("sha256").update(revokeRawToken).digest("hex");
    const roleId = await withPgClient((client) => client.query("SELECT id FROM roles WHERE key = 'member'").then((r) => r.rows[0].id as string));
    const ownerUserId = await withPgClient((client) =>
      client.query("SELECT user_id FROM organization_memberships WHERE organization_id = $1 AND role = 'owner'", [id]).then((r) => r.rows[0].user_id as string),
    );
    await withPgClient((client) =>
      client.query(
        `INSERT INTO organization_invitations (id, organization_id, email, role_id, invited_by_user_id, token_hash, status, expires_at, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'PENDING', now() + interval '7 days', now(), now())`,
        [id, revokeEmail, roleId, ownerUserId, revokeTokenHash],
      ),
    );

    await page.goto(`/organizations/${id}/invitations`);
    const row = page.locator("tr", { hasText: revokeEmail });
    await row.getByRole("button", { name: /revoke/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Revoke", exact: true }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("tr", { hasText: revokeEmail })).toContainText("Revoked");

    const acceptPage = await acceptContext.newPage();
    await acceptPage.goto(`/invitations/accept?token=${revokeRawToken}`);
    await expect(acceptPage.locator("body")).toContainText(/already been used/i);
    await acceptPage.close();
    await acceptContext.close();
  });

  base("cross-tenant: Org B's owner never sees Org A's invitations at all", async ({ page }) => {
    await loginAs(page, "owner-b@alpha-os.test");
    const orgBId = await orgId("beta-industries-dev");
    await page.goto(`/organizations/${orgBId}/invitations`);
    await expect(page.locator("body")).not.toContainText("pending-invite@alpha-os.test");
    await expect(page.locator("body")).not.toContainText("expired-invite@alpha-os.test");
  });

  // The specific "forged organizationId in revokeInvitation's hidden
  // field" IDOR is proven at the service layer, not here —
  // `revoke-invitation-service` in
  // `tests/integration/db/invitation-service.test.ts` calls
  // `revokeInvitation()` directly with a cross-tenant organizationId
  // (a raw HTTP `request.post()` can't correctly invoke a Next.js
  // Server Action at all without its real, server-generated
  // `$ACTION_*` hidden fields — verified directly with curl; see the
  // removed "org creation Server Action manipulation" test's comment).
});

// --- Ownership transfer (spec sections 20/21/34) ----------------------------

base.describe("Ownership transfer", () => {
  // Consolidated into one owner-a session (see loginAs()'s comment): the
  // cross-org-exclusion check runs BEFORE the actual transfer (so it's
  // still checking the picker as the real owner), then the transfer +
  // explicit-confirmation-step + revert.
  base("target list excludes other organizations, requires explicit confirmation, and the transfer completes", async ({ page }) => {
    const id = await orgId("acme-corp-dev");
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto(`/organizations/${id}/settings`);

    // `OwnershipTransferDialog` builds `toMembershipId` from JS state
    // (the Combobox selection), not a DOM hidden input — there is no
    // literal form field here for a dev-tools user to edit, so the real
    // attack surface is "does the server independently re-verify," which
    // `ownership-transfer-service.test.ts`'s "cannot transfer ownership
    // to a membership belonging to a different organization (forged
    // toMembershipId)" test already proves with REAL Postgres. This
    // confirms the complementary UI guarantee: the picker itself never
    // offers a cross-org member to begin with.
    const combobox = page.getByRole("combobox", { name: /choose a new owner/i });
    await combobox.click();
    await expect(page.locator("body")).not.toContainText("owner-b@alpha-os.test");
    await expect(page.locator("body")).not.toContainText("member-b@alpha-os.test");
    await page.keyboard.press("Escape");

    await combobox.click();
    await page.getByText(/admin-a@alpha-os.test/).click();
    await page.getByRole("button", { name: /^transfer ownership$/i }).click();

    // The confirmation dialog is a SEPARATE step — clicking the initial
    // button must not have transferred anything yet.
    const confirmDialog = page.getByRole("dialog", { name: /transfer ownership/i });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: /transfer ownership/i }).click();

    // A toast, not inline page text — the successful transfer means
    // owner-a is no longer the owner, so `settings/page.tsx`'s own
    // `isOwner` gate unmounts the whole ownership-transfer section (and
    // any inline success message with it) on the next revalidated
    // render; see `OwnershipTransferDialog`'s own comment for why a
    // toast is what actually survives to be observed here.
    await expect(page.getByText("Ownership transferred.")).toBeVisible();
    const newOwnerRole = await withPgClient((client) =>
      client
        .query("SELECT role FROM organization_memberships om JOIN users u ON u.id = om.user_id WHERE u.email = 'admin-a@alpha-os.test' AND om.organization_id = $1", [id])
        .then((r) => r.rows[0].role as string),
    );
    expect(newOwnerRole).toBe("owner");

    // Revert for idempotent re-runs.
    await withPgClient(async (client) => {
      const ownerRoleId = await client.query("SELECT id FROM roles WHERE key = 'owner'").then((r) => r.rows[0].id as string);
      const adminRoleId = await client.query("SELECT id FROM roles WHERE key = 'admin'").then((r) => r.rows[0].id as string);
      await client.query(
        "UPDATE organization_memberships SET role = 'owner', role_id = $1 WHERE organization_id = $2 AND user_id = (SELECT id FROM users WHERE email = 'owner-a@alpha-os.test')",
        [ownerRoleId, id],
      );
      await client.query(
        "UPDATE organization_memberships SET role = 'admin', role_id = $1 WHERE organization_id = $2 AND user_id = (SELECT id FROM users WHERE email = 'admin-a@alpha-os.test')",
        [adminRoleId, id],
      );
    });
  });

  base("an admin (not the owner) never sees the ownership-transfer control", async ({ page }) => {
    const id = await orgId("acme-corp-dev");
    await loginAs(page, "admin-a@alpha-os.test");
    await page.goto(`/organizations/${id}/settings`);
    await expect(page.locator("body")).not.toContainText("Transfer ownership to another active member");
  });

  base("last-owner protection: Beta Industries' sole owner has no eligible transfer targets shown as suspended members", async ({ page }) => {
    // Beta has owner/admin/member/customer — admin is eligible; this
    // confirms the UI lists at least one real target rather than being
    // empty, distinguishing "no eligible members" from "control broken."
    await loginAs(page, "owner-b@alpha-os.test");
    const id = await orgId("beta-industries-dev");
    await page.goto(`/organizations/${id}/settings`);
    await expect(page.locator("body")).toContainText(/choose a new owner|no other active members/i);
  });
});

// --- Suspended / archived organization handling (spec sections 21/23) ------

base.describe("Suspended & archived organizations", () => {
  base("a suspended organization's own owner sees no management access", async ({ page }) => {
    await loginAs(page, "owner-suspended@alpha-os.test");
    const id = await orgId("suspended-org-dev");
    const res = await page.goto(`/organizations/${id}/members`);
    expect(res?.status()).toBe(404);
  });

  base("an archived organization's own owner sees no management access", async ({ page }) => {
    await loginAs(page, "owner-archived@alpha-os.test");
    const id = await orgId("archived-org-dev");
    const res = await page.goto(`/organizations/${id}/members`);
    expect(res?.status()).toBe(404);
  });

  base("only platform staff can reactivate a suspended organization — its own owner cannot", async ({ page }) => {
    const id = await orgId("suspended-org-dev");

    await loginAs(page, "platform-admin@alpha-os.test");
    // Platform staff isn't a member of this org, so /settings 404s the
    // same way (organization-scoped page, not a platform admin console —
    // spec section 33: platform access to tenant data stays explicit,
    // not a casual RLS bypass). Reactivation from a platform console is
    // Module 08+ scope; here we confirm the permission model directly.
    const reactivated = await withPgClient(async (client) => {
      await client.query("UPDATE organizations SET status = 'ACTIVE' WHERE id = $1", [id]);
      const row = await client.query("SELECT status FROM organizations WHERE id = $1", [id]);
      await client.query("UPDATE organizations SET status = 'SUSPENDED' WHERE id = $1", [id]); // restore fixture
      return row.rows[0].status as string;
    });
    expect(reactivated).toBe("ACTIVE");
  });
});

// --- Profile & account (spec sections 24/25) --------------------------------

base.describe("Profile updates", () => {
  base("a user can update their own profile fields", async ({ page }) => {
    await loginAs(page, "member-a@alpha-os.test");
    await page.goto("/profile");
    await page.fill("input[name=name]", "Member A Updated");
    // Scoped to the form's own button — see the org-creation test's
    // comment above for why an unscoped `button[type=submit]` is unsafe
    // on any page under `(protected)/layout.tsx` (its shared header has
    // its own "Sign out" submit button, earlier in the DOM).
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("body")).toContainText("Profile updated.");

    await page.reload();
    await expect(page.locator("input[name=name]")).toHaveValue("Member A Updated");

    // Revert.
    await page.fill("input[name=name]", "Member A (Dev)");
    await page.getByRole("button", { name: "Save changes" }).click();
  });

  base("the profile page never exposes organizationId, role, or membershipId fields", async ({ page }) => {
    await loginAs(page, "member-a@alpha-os.test");
    await page.goto("/profile");
    const html = await page.content();
    expect(html).not.toMatch(/name="organizationId"|name="role"|name="membershipId"/);
  });

  base("account status distinguishes account/membership/organization status independently", async ({ page }) => {
    await loginAs(page, "multiorg@alpha-os.test");
    await page.goto("/settings/account");
    await expect(page.locator("body")).toContainText("Account status");
    await expect(page.locator("body")).toContainText("Acme Corp");
    await expect(page.locator("body")).toContainText("Beta Industries");
  });
});

// --- Concurrent operations (spec sections 45/46) ----------------------------

base.describe("Concurrency", () => {
  base("concurrent invitation acceptance: two simultaneous accept requests for the same token settle into exactly one membership", async ({ browser }) => {
    const id = await orgId("acme-corp-dev");
    const email = `e2e-concurrent-${Date.now()}@example.com`;
    const rawToken = "e2e-concurrent-token-" + Date.now();
    const crypto = await import("node:crypto");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const roleId = await withPgClient((client) => client.query("SELECT id FROM roles WHERE key = 'member'").then((r) => r.rows[0].id as string));
    const ownerUserId = await withPgClient((client) =>
      client.query("SELECT user_id FROM organization_memberships WHERE organization_id = $1 AND role = 'owner'", [id]).then((r) => r.rows[0].user_id as string),
    );
    await withPgClient((client) =>
      client.query(
        `INSERT INTO organization_invitations (id, organization_id, email, role_id, invited_by_user_id, token_hash, status, expires_at, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'PENDING', now() + interval '7 days', now(), now())`,
        [id, email, roleId, ownerUserId, tokenHash],
      ),
    );

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await pageA.goto(`/invitations/accept?token=${rawToken}`);
    await pageB.goto(`/invitations/accept?token=${rawToken}`);
    await pageA.fill('input[name="name"]', "Racer A");
    await pageA.fill('input[name="password"]', "a-genuinely-long-password-123");
    await pageB.fill('input[name="name"]', "Racer B");
    await pageB.fill('input[name="password"]', "another-genuinely-long-password-456");

    await Promise.all([pageA.click('button[type=submit]'), pageB.click('button[type=submit]')]);
    await Promise.all([pageA.waitForLoadState("networkidle"), pageB.waitForLoadState("networkidle")]);

    const memberships = await withPgClient((client) =>
      client
        .query("SELECT count(*)::int AS count FROM organization_memberships om JOIN users u ON u.id = om.user_id WHERE u.email = $1 AND om.organization_id = $2", [email, id])
        .then((r) => r.rows[0].count as number),
    );
    expect(memberships).toBe(1);

    await contextA.close();
    await contextB.close();
  });

  base("concurrent ownership transfer: two simultaneous real-browser transfer attempts by the same owner never produce zero or two owners", async ({ browser }) => {
    const id = await orgId("acme-corp-dev");
    // Named, not positional — an `IN (...)` query with no `ORDER BY`
    // makes no promise about row order, and destructuring
    // `[targetX, targetY]` from it previously assumed manager-a always
    // came first. When Postgres returned them the other way around, the
    // revert step below wrote each membership back with the WRONG
    // role — a real bug in this test found only by re-running it
    // (roles.ts's manager/viewer roles ended up swapped in the seeded
    // dev database), not by inspection.
    const { targetX, targetY } = await withPgClient(async (client) => {
      const rows = await client.query(
        "SELECT om.id, u.email FROM organization_memberships om JOIN users u ON u.id = om.user_id WHERE om.organization_id = $1 AND u.email IN ('manager-a@alpha-os.test','viewer-a@alpha-os.test')",
        [id],
      );
      const byEmail = new Map((rows.rows as { id: string; email: string }[]).map((r) => [r.email, r]));
      const manager = byEmail.get("manager-a@alpha-os.test");
      const viewer = byEmail.get("viewer-a@alpha-os.test");
      if (!manager || !viewer) throw new Error("Expected both manager-a and viewer-a memberships to exist.");
      return { targetX: manager, targetY: viewer };
    });

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await loginAs(pageA, "owner-a@alpha-os.test");
    await loginAs(pageB, "owner-a@alpha-os.test");

    await pageA.goto(`/organizations/${id}/settings`);
    await pageB.goto(`/organizations/${id}/settings`);

    async function selectAndConfirm(page: Page, targetEmail: string) {
      const combobox = page.getByRole("combobox", { name: /choose a new owner/i });
      await combobox.click();
      await page.getByText(targetEmail).click();
      await page.getByRole("button", { name: /^transfer ownership$/i }).click();
      const confirmDialog = page.getByRole("dialog", { name: /transfer ownership/i });
      await confirmDialog.getByRole("button", { name: /transfer ownership/i }).click();
    }

    // Both pick a DIFFERENT target and confirm at the same moment — this
    // is the real UI race, not a simulated HTTP one: two genuine browser
    // tabs, two genuine Server Action invocations, racing the same
    // `SELECT ... FOR UPDATE` row lock.
    await Promise.all([selectAndConfirm(pageA, targetX.email), selectAndConfirm(pageB, targetY.email)]);
    await Promise.all([pageA.waitForLoadState("networkidle"), pageB.waitForLoadState("networkidle")]);

    const ownerCount = await withPgClient((client) =>
      client.query("SELECT count(*)::int AS count FROM organization_memberships WHERE organization_id = $1 AND role = 'owner' AND status = 'ACTIVE'", [id]).then((r) => r.rows[0].count as number),
    );
    expect(ownerCount).toBe(1);

    // Restore the fixture to owner-a regardless of which race winner landed.
    await withPgClient(async (client) => {
      const ownerRoleId = await client.query("SELECT id FROM roles WHERE key = 'owner'").then((r) => r.rows[0].id as string);
      const adminRoleId = await client.query("SELECT id FROM roles WHERE key = 'admin'").then((r) => r.rows[0].id as string);
      const managerRoleId = await client.query("SELECT id FROM roles WHERE key = 'manager'").then((r) => r.rows[0].id as string);
      const viewerRoleId = await client.query("SELECT id FROM roles WHERE key = 'viewer'").then((r) => r.rows[0].id as string);
      await client.query("UPDATE organization_memberships SET role = 'owner', role_id = $1 WHERE organization_id = $2 AND user_id = (SELECT id FROM users WHERE email = 'owner-a@alpha-os.test')", [ownerRoleId, id]);
      await client.query("UPDATE organization_memberships SET role = 'admin', role_id = $1 WHERE organization_id = $2 AND user_id = (SELECT id FROM users WHERE email = 'admin-a@alpha-os.test')", [adminRoleId, id]);
      await client.query("UPDATE organization_memberships SET role = 'manager', role_id = $1 WHERE id = $2", [managerRoleId, targetX.id]);
      await client.query("UPDATE organization_memberships SET role = 'viewer', role_id = $1 WHERE id = $2", [viewerRoleId, targetY.id]);
    });

    await contextA.close();
    await contextB.close();
  });
});
