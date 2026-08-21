import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Module 12 (Organization Security, Settings & Governance) E2E — real
 * browser, real running app, real database, against a production build.
 * Business-rule coverage (validation, enforcement, RLS, notification
 * fan-out) is already proven at the database layer
 * (`organization-security-service.test.ts`, `invitation-service.test.ts`'s
 * Module 12 section, `organization-invitation-policy-rls.test.ts`); this
 * file's job is proving the real UI on `/organizations/[id]/settings`
 * is wired to that service layer, and that the owner-only split
 * actually reaches the rendered page, not just the API.
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

async function orgIdBySlug(slug: string): Promise<string> {
  return withPgClient((client) => client.query("SELECT id FROM organizations WHERE slug = $1", [slug]).then((r) => r.rows[0].id as string));
}

/**
 * Resets Org A's invitation policy row to a known state before each
 * test that reads/writes it — this spec's own precondition, established
 * directly rather than trusted from whatever a previous test run left
 * behind (same discipline `organization-management-accessibility.spec.ts`'s
 * own `ensureOrgStatus()` already documents).
 */
async function resetInvitationPolicy(organizationId: string): Promise<void> {
  await withPgClient((client) => client.query("DELETE FROM organization_invitation_policies WHERE organization_id = $1", [organizationId]));
}

base.describe("Organization security & governance (invitation policy)", () => {
  base("the owner sees the Security section, toggles the owner-only-invite policy, and it persists", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await resetInvitationPolicy(orgAId);

    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/settings`);

    // Scoped to the Security section specifically — the page also has a
    // Profile form with its own "Save changes" button (same label, by
    // design), so an unscoped locator is ambiguous.
    const securitySection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Security", exact: true }) });
    await expect(securitySection).toBeVisible();
    const requireOwnerSwitch = securitySection.getByLabel("Require the owner to send invitations");
    await expect(requireOwnerSwitch).toBeVisible();
    await expect(requireOwnerSwitch).not.toBeChecked();

    await requireOwnerSwitch.click();
    await securitySection.getByLabel("Allowed domains").fill("acme.example");
    await securitySection.getByLabel("Invitation link expiry (hours)").fill("48");
    await securitySection.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Invitation policy updated.")).toBeVisible();
    await expect(requireOwnerSwitch).toBeChecked();

    // Persisted server-side, not just optimistic UI state — reload and re-check.
    await page.reload();
    const reloadedSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Security", exact: true }) });
    await expect(reloadedSection.getByLabel("Require the owner to send invitations")).toBeChecked();
    await expect(reloadedSection.getByLabel("Allowed domains")).toHaveValue("acme.example");
    await expect(reloadedSection.getByLabel("Invitation link expiry (hours)")).toHaveValue("48");

    await resetInvitationPolicy(orgAId);
  });

  base("an admin sees the Security section read-only — organizations.security.read without .update", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await resetInvitationPolicy(orgAId);

    await loginAs(page, "admin-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/settings`);

    const securitySection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Security", exact: true }) });
    await expect(securitySection).toBeVisible();
    await expect(securitySection.getByLabel("Require the owner to send invitations")).toBeDisabled();
    await expect(securitySection.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(securitySection.getByText("Only the organization owner can change this policy.")).toBeVisible();
  });

  base("a member sees no Security section at all — lacks organizations.security.read", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");

    await loginAs(page, "member-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/settings`);

    // A member has no organizations.update either, so the whole settings
    // page renders the generic access-denied state — this assertion is
    // really about the SAME boundary applying consistently, not a
    // Security-section-specific gap.
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Security" })).toHaveCount(0);
  });

  base("Org B's owner cannot reach Org A's security settings by forging the URL (cross-tenant IDOR)", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");

    await loginAs(page, "owner-b@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/settings`);

    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });
});
