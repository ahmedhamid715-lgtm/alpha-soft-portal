import { test as base, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Proposals & Contracts accessibility coverage (Build 22 — Roadmap
 * Module 16) — direct style/helper template from
 * `sales-team-accessibility.spec.ts`. Written directly by Claude, same
 * reasoning as `proposals-contracts.spec.ts`'s own top comment.
 */
base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);
});

const PASSWORD = "alpha-os-dev-password";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://ahmed@localhost:5432/alpha_os_dev";
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
} as const;

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

async function seededIds() {
  return withPgClient(async (client) => {
    const proposal = await client.query("SELECT id, status FROM crm_proposals WHERE proposal_number LIKE 'PROP-%' ORDER BY created_at ASC LIMIT 1");
    const acceptedProposal = await client.query("SELECT id FROM crm_proposals WHERE status = 'ACCEPTED' LIMIT 1");
    const contract = await client.query("SELECT id FROM crm_contracts LIMIT 1");
    return {
      proposalId: proposal.rows[0]?.id as string | undefined,
      acceptedProposalId: acceptedProposal.rows[0]?.id as string | undefined,
      contractId: contract.rows[0]?.id as string | undefined,
    };
  });
}

async function expectNoApplicationError(page: Page) {
  await expect(page.locator("body")).not.toContainText("Application error");
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  await expectNoApplicationError(page);
}

async function setColorScheme(page: Page, scheme: "light" | "dark") {
  await page.evaluate((value) => window.localStorage.setItem("theme", value), scheme);
}

/** See `sales-team-accessibility.spec.ts`'s own identical constant/comment — STILL DEFERRED for the exact reason `proposals-contracts.md` "Accessibility" now documents. */
const KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS = ["aria-hidden-focus", "landmark-one-main", "page-has-heading-one", "region"];

async function scan(page: Page, excludeRuleIds: string[] = []) {
  const builder = new AxeBuilder({ page });
  if (excludeRuleIds.length > 0) builder.disableRules(excludeRuleIds);
  const results = await builder.analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

base.describe("Proposals & Contracts accessibility (Module 16)", () => {
  base("list, detail, template, and contract pages have no axe violations on desktop in either theme", async ({ page }) => {
    const { proposalId, contractId } = await seededIds();
    await page.setViewportSize(VIEWPORTS.desktop);
    await loginAs(page, "platform-admin@alpha-os.test");

    for (const scheme of ["light", "dark"] as const) {
      await setColorScheme(page, scheme);
      const paths = ["/admin/crm/proposals", "/admin/crm/proposals/templates", "/admin/crm/contracts"];
      if (proposalId) paths.push(`/admin/crm/proposals/${proposalId}`);
      if (contractId) paths.push(`/admin/crm/contracts/${contractId}`);
      for (const path of paths) {
        await goto(page, path);
        await expect(page.getByRole("main")).toBeVisible();
        await scan(page);
      }
    }
  });

  base("the new-proposal form (line-item editor, pricing summary) has no axe violations", async ({ page }) => {
    const dealId = await withPgClient((client) =>
      client.query("SELECT id FROM crm_deals WHERE title = $1", ["Technical SEO retainer — Globex Logistics"]).then((r) => r.rows[0].id as string),
    );
    await loginAs(page, "platform-admin@alpha-os.test");
    await setColorScheme(page, "dark");
    await goto(page, `/admin/crm/proposals/new?dealId=${dealId}`);

    await page.getByLabel("Title").fill("Accessibility scan draft");
    await page.getByRole("textbox", { name: "Proposal body" }).fill("<p>Scan body.</p>");
    await page.getByLabel("Item", { exact: true }).first().fill("Line item for scan");
    await page.getByLabel("Unit price").first().fill("100");
    await page.getByRole("button", { name: "Add line item" }).click();
    await scan(page);
  });

  base("an accepted proposal's detail page (contract-creation prompt) has no axe violations", async ({ page }) => {
    const { acceptedProposalId } = await seededIds();
    base.skip(!acceptedProposalId, "No ACCEPTED seed proposal found.");
    await loginAs(page, "platform-admin@alpha-os.test");
    await setColorScheme(page, "dark");
    await goto(page, `/admin/crm/proposals/${acceptedProposalId}`);
    await expect(page.getByText("ACCEPTED", { exact: true }).first()).toBeVisible();
    await scan(page);
  });

  base("open Select controls on the new-proposal form have no axe violations outside the known platform limitation", async ({ page }) => {
    const dealId = await withPgClient((client) =>
      client.query("SELECT id FROM crm_deals WHERE title = $1", ["Technical SEO retainer — Globex Logistics"]).then((r) => r.rows[0].id as string),
    );
    await loginAs(page, "platform-admin@alpha-os.test");
    await setColorScheme(page, "dark");
    await goto(page, `/admin/crm/proposals/new?dealId=${dealId}`);

    await page.getByLabel("Currency").click();
    await expect(page.getByRole("option").first()).toBeVisible();
    await scan(page, KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS);
  });

  for (const scheme of ["light", "dark"] as const) {
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      base(`Proposals list has no axe violations (${scheme}, ${viewportName})`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await loginAs(page, "platform-admin@alpha-os.test");
        await setColorScheme(page, scheme);
        await goto(page, "/admin/crm/proposals");
        await scan(page);
      });
    }
  }
});
