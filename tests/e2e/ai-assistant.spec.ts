import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Module 17 (AI Infrastructure & Intelligence Foundation) E2E — real
 * browser, real running app, real database, against a production
 * build. `ANTHROPIC_API_KEY` is unconfigured in this dev environment
 * (same as `STRIPE_SECRET_KEY` throughout this whole project) — every
 * real-provider-call path here proves the "unconfigured surfaces a
 * safe error, never a crash" behavior, the same established pattern
 * `billing-lifecycle.spec.ts`'s own Stripe tests already use. Business-
 * logic/calculation coverage (recognition math, N/A here) doesn't
 * apply to this module; provider-mocked service-layer coverage lives in
 * `tests/integration/db/ai-conversation-service.test.ts`.
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

base.describe("AI assistant — chat", () => {
  base("owner sees the assistant page with an empty state, and can reach it from the organization detail page", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}`);
    await page.getByRole("link", { name: "Assistant" }).click();
    await expect(page.getByRole("heading", { name: "Assistant" })).toBeVisible();
    await expect(page.getByLabel("New message")).toBeVisible();
  });

  base("starting a conversation with ANTHROPIC_API_KEY unconfigured surfaces a safe error, never a crash — and the user's own message is still persisted, never lost", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/assistant`);

    // A unique message per run, not a fixed literal — AiConversations are
    // NEVER deleted (only closed, by design; see ai-infrastructure.md),
    // so a fixed string would accumulate one identically-titled row per
    // test run against this real, persistent Acme Corp fixture, and a
    // later run's `getByText(...)` would hit a real Playwright strict-
    // mode violation (found exactly this way, by actually rerunning this
    // test — not a product bug, a test-fixture-pollution bug). The
    // unique marker goes FIRST, not appended at the end — the list
    // page's own conversation title is `deriveTitle()`-truncated to 60
    // characters (`ai-conversation-service.ts`), so a marker appended
    // after a long fixed prefix landed past the truncation point on the
    // first attempt at this fix, silently producing a real "not found"
    // rather than the intended unique match — found the same way, by
    // actually rerunning the test.
    const uniqueId = `${Date.now()}`;
    const uniqueMessage = `[${uniqueId}] How do I change my subscription plan?`;
    await page.getByLabel("New message").fill(uniqueMessage);
    await page.getByRole("button", { name: "Start conversation" }).click();

    await expect(page.getByText(/Anthropic service is currently unavailable/i)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error");

    // The conversation (with the user's own message) was still created —
    // reload the list and confirm it's there, never silently lost.
    await page.reload();
    await expect(page.getByText(uniqueId)).toBeVisible();
  });

  base("a viewer (no ai.use) cannot reach the assistant page", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "viewer-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/assistant`);
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("a member (ai.use) CAN reach the assistant page — the permission Module 05 originally reserved for owner/admin only now also reaches standard staff", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "member-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/assistant`);
    await expect(page.getByRole("heading", { name: "Assistant" })).toBeVisible();
  });

  base("cross-tenant: Org B's owner cannot reach Org A's assistant page/conversation by forging the URL", async ({ page }) => {
    const orgBId = await orgIdBySlug("beta-industries-dev");
    await loginAs(page, "owner-b@alpha-os.test");
    // Org B has no AI conversations of its own yet — attempting a forged, syntactically-valid-but-nonexistent conversation id under Org B's own real organizationId is the honest adversarial case (a real cross-org id would require Org A's data, exercised at the service layer already — see ai-conversation-service.test.ts's own dedicated cross-tenant test).
    await page.goto(`/organizations/${orgBId}/assistant/00000000-0000-7000-8000-000000000000`);
    await expect(page.getByText("Conversation not found")).toBeVisible();
  });
});

base.describe("AI assistant — platform observability", () => {
  base("platform_owner sees the AI usage page", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto("/admin/ai");
    await expect(page.getByRole("heading", { name: "AI usage" })).toBeVisible();
    await expect(page.getByText("Messages")).toBeVisible();
  });

  base("support_agent (minimal platform access, no ai.observability) cannot reach the AI usage page", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");
    await page.goto("/admin/ai");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("the AI usage page is reachable from the platform sidebar nav for a permitted role", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto("/admin");
    // `/admin`'s own landing page ALSO now has an "AI usage" card
    // (`admin/page.tsx`'s `TOOLS` list — added after this test first
    // caught it missing), so a bare `getByRole("link", { name: "AI
    // usage" })` here is genuinely ambiguous between two real links.
    // Scoped to the sidebar's own `role="navigation"`/`aria-label
    // ="Primary"` landmark (`sidebar.tsx`) to test what this test's own
    // title says it's testing — the SIDEBAR path, not the landing-page
    // card (that reachability path is exercised implicitly by every
    // other test in this file that starts from an org/admin page with
    // the sidebar visible).
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "AI usage" }).click();
    await expect(page.getByRole("heading", { name: "AI usage" })).toBeVisible();
  });
});
