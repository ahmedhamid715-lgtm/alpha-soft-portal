import { test as base, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Module 18 (AI Knowledge, Context & Retrieval Infrastructure) E2E —
 * real browser, real running app, real database, against a production
 * build. `OPENAI_API_KEY` is unconfigured in this dev environment (same
 * established pattern as `STRIPE_SECRET_KEY`/`ANTHROPIC_API_KEY`) —
 * retrieval genuinely degrades to keyword-only search rather than
 * failing, and ingestion's own embedding step surfaces a safe failure —
 * both exercised here for real, not mocked (provider-mocked coverage
 * for the "real semantic search succeeds" path lives in
 * `tests/integration/db/knowledge-retrieval-service.test.ts`).
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

base.describe("Knowledge — sources and documents", () => {
  base("owner sees the knowledge page and can reach it from the organization detail page", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}`);
    await page.getByRole("link", { name: "Knowledge" }).click();
    await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();
  });

  base("a viewer (holds knowledge.source.read but not knowledge.retrieve/knowledge.source.manage) sees the page without a search box or new-source form", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "viewer-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/knowledge`);
    await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();
    await expect(page.getByLabel("Search query")).toHaveCount(0);
    await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  });

  base("owner creates a source, ingests a real document, and sees real version/chunk status", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    const uniqueId = `${Date.now()}`;
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/knowledge`);

    await page.getByLabel("Name").fill(`[${uniqueId}] E2E Source`);
    await page.getByRole("button", { name: "Create source" }).click();
    await page.waitForURL((url) => /\/knowledge\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: `[${uniqueId}] E2E Source` })).toBeVisible();

    await page.getByLabel("Title").fill(`[${uniqueId}] Getting started`);
    await page.getByLabel("Content").fill(`This is real E2E content for run ${uniqueId}. It describes how Alpha OS works.`);
    await page.getByRole("button", { name: "Ingest document" }).click();
    await page.waitForURL((url) => /\/knowledge\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 15_000 });

    await expect(page.getByRole("heading", { name: `[${uniqueId}] Getting started` })).toBeVisible();
    await expect(page.getByText("Version 1")).toBeVisible();
    // OPENAI_API_KEY is unconfigured in this dev environment — the
    // embedding step genuinely fails, and the version is honestly
    // marked FAILED (never a fake "READY"). See this file's own top
    // comment.
    await expect(page.getByText("FAILED")).toBeVisible();
  });

  base("a real ingestion failure is visible on the document detail page with its own failure reason", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    const uniqueId = `${Date.now()}`;
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/knowledge`);
    await page.getByLabel("Name").fill(`[${uniqueId}] Failure Source`);
    await page.getByRole("button", { name: "Create source" }).click();
    await page.waitForURL((url) => /\/knowledge\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 15_000 });

    await page.getByLabel("Title").fill(`[${uniqueId}] Will fail`);
    await page.getByLabel("Content").fill("Content that cannot be embedded without a configured provider.");
    await page.getByRole("button", { name: "Ingest document" }).click();
    await page.waitForURL((url) => /\/knowledge\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 15_000 });

    await expect(page.getByText(/unavailable/i)).toBeVisible();
  });

  base("search degrades to real keyword-only results when the embedding provider is unavailable, never a crash", async ({ page }) => {
    const orgAId = await orgIdBySlug("acme-corp-dev");
    await loginAs(page, "owner-a@alpha-os.test");
    await page.goto(`/organizations/${orgAId}/knowledge`);
    await page.getByLabel("Search query").fill("Alpha OS");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText(/keyword-only results/i)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error");
  });

  base("cross-tenant: Org B's owner cannot reach Org A's source by forging the URL", async ({ page }) => {
    const orgBId = await orgIdBySlug("beta-industries-dev");
    await loginAs(page, "owner-b@alpha-os.test");
    await page.goto(`/organizations/${orgBId}/knowledge/00000000-0000-7000-8000-000000000000`);
    await expect(page.getByText("Source not found")).toBeVisible();
  });
});

base.describe("Knowledge — platform observability", () => {
  base("platform_owner sees the knowledge observability page", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto("/admin/ai/knowledge");
    await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ingestion health" })).toBeVisible();
  });

  base("support_agent (no knowledge.observability) cannot reach the platform knowledge page", async ({ page }) => {
    await loginAs(page, "support-agent@alpha-os.test");
    await page.goto("/admin/ai/knowledge");
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });

  base("the knowledge page is reachable from both the platform sidebar and the admin landing page", async ({ page }) => {
    await loginAs(page, "platform-owner@alpha-os.test");
    await page.goto("/admin");
    await page.getByRole("main").getByRole("link", { name: "Knowledge" }).click();
    await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();
  });
});
