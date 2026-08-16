import { test as base, expect } from "@playwright/test";
import { serverIsReachable } from "./fixtures";

/**
 * Module 05 (RBAC & Authorization) E2E — real browser, real running app,
 * real database, real seeded accounts (`prisma/seed-rbac.ts`). No
 * authorization is mocked (spec section 43).
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);
});

const PASSWORD = "alpha-os-dev-password";

async function loginAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

base.describe("Role visibility by persona", () => {
  base("a platform admin sees the platform system-role catalog", async ({ page }) => {
    await loginAs(page, "platform-admin@alpha-os.test");
    await page.goto("/admin/roles");
    await expect(page.locator("body")).toContainText("Platform Administrator");
    await expect(page.locator("body")).toContainText("System");
    // No member-management section for the platform view.
    await expect(page.locator("body")).not.toContainText("Assign a role to each member");
  });

  base("an organization owner sees their org's roles and a member list with role assignment", async ({ page }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto("/admin/roles");
    await expect(page.locator("body")).toContainText("Organization Owner");
    await expect(page.locator("body")).toContainText("Members");
    await expect(page.locator("body")).toContainText("member-a@alpha-os.test");
  });

  base("a customer cannot view the roles page at all — sees a denial, not data", async ({ page }) => {
    await loginAs(page, "customer-a@alpha-os.test");
    await page.goto("/admin/roles");
    await expect(page.locator("body")).toContainText("don't have access");
    await expect(page.locator("body")).not.toContainText("Organization Owner");
  });

  base("a manager sees roles (roles.read) but cannot assign them — no members.update", async ({ page }) => {
    await loginAs(page, "manager-a@alpha-os.test");
    await page.goto("/admin/roles");
    await expect(page.locator("body")).toContainText("requires members.update");
    const firstSelect = page.locator("select[name=roleId]").first();
    await expect(firstSelect).toBeDisabled();
  });
});

base.describe("Privilege escalation via the real UI", () => {
  base("a manager cannot promote a member through the role-assignment form, even by forcing the disabled control", async ({ page }) => {
    await loginAs(page, "manager-a@alpha-os.test");
    await page.goto("/admin/roles");

    // Force-enable the disabled <select>/<button> via the DOM and submit
    // anyway — simulates a manipulated request bypassing the UI's own
    // (UX-only, spec section 16) disabled state. The server must still
    // reject it independently.
    await page.evaluate(() => {
      document.querySelectorAll<HTMLSelectElement | HTMLButtonElement>("select[name=roleId], button[type=submit]").forEach((el) => {
        el.disabled = false;
      });
    });

    const form = page.locator("form").filter({ has: page.locator("select[name=roleId]") }).first();
    await form.locator("select[name=roleId]").selectOption({ label: "Organization Administrator" });
    await form.locator("button[type=submit]").click();

    await expect(page.locator("body")).toContainText(/permission/i);
  });
});

base.describe("Cross-tenant isolation", () => {
  base("Org A's owner cannot see Org B's members even by guessing at the page", async ({ page }) => {
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto("/admin/roles");
    await expect(page.locator("body")).not.toContainText("owner-b@alpha-os.test");
    await expect(page.locator("body")).not.toContainText("member-b@alpha-os.test");
  });
});

base.describe("Route-level access (spec section 17)", () => {
  base("an unauthenticated visitor hitting /admin/roles is bounced to login, not shown a denial page", async ({ page }) => {
    await page.goto("/admin/roles");
    await expect(page).toHaveURL(/\/login/);
  });
});
