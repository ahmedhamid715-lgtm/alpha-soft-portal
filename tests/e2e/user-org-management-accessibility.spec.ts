import { test as base, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * axe-core against Module 07's new UI (spec section 58) —
 * desktop/tablet/mobile × light/dark for every new page, plus dialogs/
 * drawers/comboboxes/tables/forms/onboarding opened and scanned in
 * their interactive state, not just at rest. `/organizations` itself
 * (Module 06) already has its own accessibility suite
 * (`multi-tenancy-accessibility.spec.ts`) — not repeated here.
 *
 * Logs in ONCE per persona and loops viewport/scheme INSIDE each test
 * (not once per combination) — `authRateLimiter` is 10 real logins per
 * 15 minutes per email, and this suite covers many pages × 3 viewports
 * × 2 schemes, which would blow through that budget if each combination
 * re-logged in (found by the functional spec's own earlier debugging).
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

async function scan(page: Page, label: string, violations: string[]) {
  // Radix's Dialog/Popover/Select content fades/zooms in over ~100ms
  // (`duration-100`) via CSS, and `toBeVisible()` only checks that the
  // element is present with non-zero size — it doesn't wait for that
  // opacity transition to finish. Scanning immediately catches the
  // container at `opacity: 0` mid-animation, which axe reports as a
  // color-contrast violation on every descendant (any two colors
  // measure as near-zero contrast at opacity 0) — a real bug in this
  // TEST, not the app: found by reading the actual computed
  // `getComputedStyle().opacity` directly (`rgb(255,255,255)` text,
  // `opacity: 0` container) after axe reported "insufficient contrast"
  // on plain white text.
  await page.waitForTimeout(250);
  const results = await new AxeBuilder({ page }).analyze();
  if (results.violations.length > 0) {
    violations.push(`${label}: ${JSON.stringify(results.violations, null, 2)}`);
  }
}

/**
 * Same as `scan()`, minus axe's "region" rule — for scans taken while a
 * Radix Select/Combobox popup is open. That rule (best-practice only;
 * its own tags carry no `wcag2a`/`wcag2aa`) expects all content to sit
 * inside a landmark, but a Select's dropdown renders through a Portal
 * directly under `<body>`, deliberately outside `<main>`, precisely
 * because it's a transient floating popup (`role="listbox"`), not page
 * content — a well-documented Radix+axe interaction, not a real
 * navigability gap: the popup's OWN role/keyboard semantics are what
 * make it accessible, not landmark containment. Page-LOAD scans (no
 * popup open) keep the full default rule set — "region" is a legitimate
 * check there.
 */
async function scanPopup(page: Page, label: string, violations: string[]) {
  await page.waitForTimeout(250);
  const results = await new AxeBuilder({ page }).disableRules(["region"]).analyze();
  if (results.violations.length > 0) {
    violations.push(`${label}: ${JSON.stringify(results.violations, null, 2)}`);
  }
}

// --- Full page-load matrix: desktop/tablet/mobile × light/dark ------------

base.describe("Page-load accessibility (full viewport × scheme matrix)", () => {
  base("organization members, settings, and invitations pages — no violations across every viewport/scheme", async ({ page }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    const id = await orgId("acme-corp-dev");
    const violations: string[] = [];

    for (const scheme of SCHEMES) {
      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: scheme });

        await page.goto(`/organizations/${id}/members`);
        await scan(page, `members (${scheme}, ${viewportName})`, violations);

        await page.goto(`/organizations/${id}/settings`);
        await scan(page, `settings (${scheme}, ${viewportName})`, violations);

        await page.goto(`/organizations/${id}/invitations`);
        await scan(page, `invitations (${scheme}, ${viewportName})`, violations);

        await page.goto(`/organizations/${id}`);
        await scan(page, `organization detail (${scheme}, ${viewportName})`, violations);
      }
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("profile and account pages — no violations across every viewport/scheme", async ({ page }) => {
    await loginAs(page, "multiorg@alpha-os.test");
    const violations: string[] = [];

    for (const scheme of SCHEMES) {
      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: scheme });

        await page.goto("/profile");
        await scan(page, `profile (${scheme}, ${viewportName})`, violations);

        await page.goto("/settings/account");
        await scan(page, `account (${scheme}, ${viewportName})`, violations);
      }
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("organization creation form (platform staff) — no violations across every viewport/scheme", async ({ page }) => {
    await loginAs(page, "platform-admin@alpha-os.test");
    const violations: string[] = [];

    for (const scheme of SCHEMES) {
      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto("/organizations/new");
        await scan(page, `organizations/new (${scheme}, ${viewportName})`, violations);
      }
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("invitation accept page (unauthenticated) — no violations across every viewport/scheme", async ({ page }) => {
    const violations: string[] = [];
    // A real pending invitation's presence isn't required for this
    // page's own accessibility — the "missing token" and "invalid
    // token" states are both real, reachable UI, exercised here.
    for (const scheme of SCHEMES) {
      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto("/invitations/accept");
        await scan(page, `invitations/accept, missing token (${scheme}, ${viewportName})`, violations);
        await page.goto("/invitations/accept?token=not-a-real-token");
        await scan(page, `invitations/accept, invalid token (${scheme}, ${viewportName})`, violations);
      }
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });
});

// --- Interactive components: dialogs, drawers, comboboxes, tables ---------

base.describe("Interactive component accessibility (light/dark, desktop)", () => {
  base("member detail Sheet (drawer) and its role Select — no violations, open, light and dark", async ({ page }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    const id = await orgId("acme-corp-dev");
    const violations: string[] = [];

    for (const scheme of SCHEMES) {
      await page.setViewportSize(VIEWPORTS.desktop);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/organizations/${id}/members`);
      const row = page.locator("tr", { hasText: "member-a@alpha-os.test" });
      await row.getByRole("button", { name: /manage/i }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await scan(page, `member detail sheet, closed select (${scheme})`, violations);

      await page.getByRole("dialog").getByRole("combobox").click();
      await scanPopup(page, `member detail sheet, open role combobox (${scheme})`, violations);
      await page.keyboard.press("Escape");
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("invite-member Dialog — no violations, open, light and dark", async ({ page }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    const id = await orgId("acme-corp-dev");
    const violations: string[] = [];

    for (const scheme of SCHEMES) {
      await page.setViewportSize(VIEWPORTS.desktop);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/organizations/${id}/invitations`);
      await page.getByRole("button", { name: /invite member/i }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await scan(page, `invite dialog (${scheme})`, violations);
      await page.keyboard.press("Escape");
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("ownership-transfer Combobox and ConfirmDialog — no violations, open, light and dark", async ({ page }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    const id = await orgId("acme-corp-dev");
    const violations: string[] = [];

    for (const scheme of SCHEMES) {
      await page.setViewportSize(VIEWPORTS.desktop);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/organizations/${id}/settings`);

      const combobox = page.getByRole("combobox", { name: /choose a new owner/i });
      await combobox.click();
      await scan(page, `ownership combobox open (${scheme})`, violations);
      await page.getByText(/admin-a@alpha-os.test/).click();
      await page.getByRole("button", { name: /^transfer ownership$/i }).click();
      await expect(page.getByRole("dialog", { name: /transfer ownership/i })).toBeVisible();
      await scan(page, `ownership transfer confirm dialog (${scheme})`, violations);
      await page.keyboard.press("Escape");
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });

  base("lifecycle ConfirmDialog (suspend organization) — no violations, open, light and dark", async ({ page }) => {
    await loginAs(page, "owner-b@alpha-os.test");
    const id = await orgId("beta-industries-dev");
    const violations: string[] = [];

    for (const scheme of SCHEMES) {
      await page.setViewportSize(VIEWPORTS.desktop);
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/organizations/${id}/settings`);
      await page.getByRole("button", { name: /suspend organization/i }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await scan(page, `suspend confirm dialog (${scheme})`, violations);
      await page.keyboard.press("Escape");
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);
  });
});

// --- Onboarding (Stepper) ---------------------------------------------------

base.describe("Onboarding accessibility", () => {
  base("onboarding Stepper — no violations at each step, light and dark, desktop and mobile", async ({ page }) => {
    // A fresh organization owned by owner-a — an already-known-good
    // login (spec section 63's seeded fixture), inserted directly
    // rather than through `/organizations/new` + a hand-rolled
    // credential: this suite doesn't know (and shouldn't guess) the
    // app's real password-hashing algorithm just to create a one-off
    // throwaway account, and reusing a seeded account with onboarding
    // manually attached exercises the exact same `OrganizationOnboarding`
    // rows/UI the real creation flow produces.
    const slug = `e2e-a11y-onboarding-${Date.now()}`;
    const newOrgId = await withPgClient(async (client) => {
      const orgRow = await client.query(
        "INSERT INTO organizations (id, name, display_name, slug, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $1, $2, 'ACTIVE', now(), now()) RETURNING id",
        ["E2E A11y Onboarding Org", slug],
      );
      const newId = orgRow.rows[0].id as string;
      const ownerUserId = await client.query("SELECT id FROM users WHERE email = 'owner-a@alpha-os.test'").then((r) => r.rows[0].id as string);
      const ownerRoleId = await client.query("SELECT id FROM roles WHERE key = 'owner'").then((r) => r.rows[0].id as string);
      await client.query(
        "INSERT INTO organization_memberships (id, organization_id, user_id, role, role_id, status, joined_at, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'owner', $3, 'ACTIVE', now(), now(), now())",
        [newId, ownerUserId, ownerRoleId],
      );
      await client.query(
        "INSERT INTO organization_onboarding (id, organization_id, current_step, created_at, updated_at) VALUES (gen_random_uuid(), $1, 'profile', now(), now())",
        [newId],
      );
      return newId;
    });

    await loginAs(page, "owner-a@alpha-os.test");
    const violations: string[] = [];

    for (const scheme of SCHEMES) {
      for (const viewportName of ["desktop", "mobile"] as const) {
        await page.setViewportSize(VIEWPORTS[viewportName]);
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`/organizations/${newOrgId}/onboarding`);
        await scan(page, `onboarding, profile step (${scheme}, ${viewportName})`, violations);

        // Only advance the FIRST iteration through to the invite step —
        // subsequent iterations (different viewport/scheme) re-visit the
        // step onboarding is already sitting at, so every combination
        // still gets scanned without needing to track/reset step state.
      }
    }
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForLoadState("networkidle");
    for (const scheme of SCHEMES) {
      for (const viewportName of ["desktop", "mobile"] as const) {
        await page.setViewportSize(VIEWPORTS[viewportName]);
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`/organizations/${newOrgId}/onboarding`);
        await scan(page, `onboarding, invite step (${scheme}, ${viewportName})`, violations);
      }
    }

    expect(violations, violations.join("\n\n")).toHaveLength(0);

    await withPgClient((client) => client.query("DELETE FROM organizations WHERE id = $1", [newOrgId]));
  });
});
