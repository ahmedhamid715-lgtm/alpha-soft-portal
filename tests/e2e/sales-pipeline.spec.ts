import {
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

base.beforeAll(async ({ baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(
    !reachable,
    `App not reachable at ${baseURL} — see playwright.config.ts.`,
  );
});

const PASSWORD = "alpha-os-dev-password";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://ahmed@localhost:5432/alpha_os_dev";
const MISSING_ID = "00000000-0000-7000-8000-000000000000";

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 15_000,
  });
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
  return withPgClient((client) =>
    client
      .query("SELECT id FROM organizations WHERE slug = $1", [slug])
      .then((r) => r.rows[0].id as string),
  );
}

async function seededPipelineIds() {
  const organizationId = await orgIdBySlug("alpha-os-platform");
  return withPgClient(async (client) => {
    const deal = await client.query(
      "SELECT id FROM crm_deals WHERE organization_id = $1 AND title = $2",
      [organizationId, "Technical SEO retainer — Globex Logistics"],
    );
    return { dealId: deal.rows[0].id as string };
  });
}

async function expectNoApplicationError(page: Page) {
  await expect(page.locator("body")).not.toContainText("Application error");
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  await expectNoApplicationError(page);
}

/**
 * `scope` is where the trigger lives (sometimes a sub-section
 * `Locator`, to disambiguate two same-labeled "Type" selects on the
 * settings page); the resulting listbox is NOT — Radix `SelectContent`
 * portals to `document.body`, outside `scope`'s own DOM subtree, so the
 * option itself must always be queried against the real top-level
 * `Page`, never re-scoped to `scope`. Found live by actually running
 * this spec (Codex's own sandbox couldn't launch Chromium to catch it).
 */
async function choose(scope: Page | Locator, label: string, option: string) {
  const rootPage =
    "page" in scope && typeof (scope as Locator).page === "function"
      ? (scope as Locator).page()
      : (scope as Page);
  await scope.getByLabel(label).click();
  await rootPage.getByRole("option", { name: option, exact: true }).click();
}

function stageColumn(page: Page, stageName: string): Locator {
  return page
    .getByText(stageName, { exact: true })
    .locator(
      "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' w-72 ')][1]",
    );
}

function dealCard(page: Page, title: string): Locator {
  return page
    .getByRole("link", { name: title, exact: true })
    .locator("xpath=ancestor::div[@data-slot='card']");
}

base.describe("Sales Pipeline — access control and discoverability", () => {
  base(
    "platform owner reaches the seeded board from the CRM dashboard",
    async ({ page }) => {
      await loginAs(page, "platform-owner@alpha-os.test");
      await expectNoApplicationError(page);
      await goto(page, "/admin/crm");

      // Not exact: the card link wraps both "Open deals" and its count.
      await page.getByRole("link", { name: "Open deals" }).click();
      await expect(page).toHaveURL(/\/admin\/crm\/pipeline$/);
      await expectNoApplicationError(page);
      await expect(
        page.getByRole("heading", { name: "Sales Pipeline", exact: true }),
      ).toBeVisible();
      // `getByRole("combobox", ...)`, not `getByLabel("Pipeline")` — the
      // board's own scroll region is ALSO labelled "Sales pipeline
      // board, scrollable on narrow viewports", and `getByLabel` does a
      // case-insensitive substring match, so "Pipeline" alone matches
      // both elements. The combobox role disambiguates.
      await expect(
        page.getByRole("combobox", { name: "Pipeline" }),
      ).toContainText("Sales Pipeline (default)");
      for (const stage of [
        "New",
        "Qualifying",
        "Proposal",
        "Negotiation",
        "Closed Won",
        "Closed Lost",
      ]) {
        await expect(stageColumn(page, stage)).toBeVisible();
      }
    },
  );

  base(
    "support agent cannot discover or directly access pipelines and deals",
    async ({ page }) => {
      const { dealId } = await seededPipelineIds();
      await loginAs(page, "support-agent@alpha-os.test");
      await expectNoApplicationError(page);
      await goto(page, "/admin/crm");
      await expect(page.getByRole("link", { name: "Open deals" })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("link", { name: "Sales pipeline", exact: true }),
      ).toHaveCount(0);

      for (const path of [
        "/admin/crm/pipeline",
        `/admin/crm/deals/${dealId}`,
      ]) {
        await goto(page, path);
        await expect(
          page.getByText("You don't have access to this page"),
        ).toBeVisible();
      }
    },
  );

  base(
    "support admin has read-only board and deal access without management forms",
    async ({ page }) => {
      const { dealId } = await seededPipelineIds();
      await loginAs(page, "support-admin@alpha-os.test");
      await expectNoApplicationError(page);

      await goto(page, "/admin/crm/pipeline");
      await expect(
        page.getByRole("heading", { name: "Sales Pipeline", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "New deal", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByLabel(/Move ".+" to a different stage/),
      ).toHaveCount(0);

      await goto(page, `/admin/crm/deals/${dealId}`);
      await expect(
        page.getByRole("heading", {
          name: "Technical SEO retainer — Globex Logistics",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Edit", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /Mark won|Mark lost|Reopen deal/ }),
      ).toHaveCount(0);
      await expect(page.getByLabel("Stage")).toHaveCount(0);
      await expect(page.getByLabel("Deal owner")).toHaveCount(0);

      await goto(page, "/admin/crm/settings");
      await expect(
        page.getByText("You don't have access to this page"),
      ).toBeVisible();
      await expect(page.getByLabel("New pipeline")).toHaveCount(0);
      await expect(page.getByLabel("New stage")).toHaveCount(0);
    },
  );
});

base.describe("Sales Pipeline — real deal lifecycle", () => {
  base(
    "platform admin creates, moves, edits, assigns, wins, reopens, loses, and records history",
    async ({ page }) => {
      base.setTimeout(120_000);
      const uniqueId = `${Date.now()}`;
      const wonTitle = `[${uniqueId}] E2E won lifecycle deal`;
      const lostTitle = `[${uniqueId}] E2E lost lifecycle deal`;
      const lossReason = `Budget deferred — E2E ${uniqueId}`;
      const note = `E2E pipeline note ${uniqueId}`;

      await loginAs(page, "platform-admin@alpha-os.test");
      await expectNoApplicationError(page);
      await goto(page, "/admin/crm/pipeline");

      await page.getByLabel("Title").fill(wonTitle);
      await choose(page, "Company", "Acme Retail Group");
      await page.getByRole("button", { name: "Create deal" }).click();
      await expect(
        stageColumn(page, "New").getByRole("link", {
          name: wonTitle,
          exact: true,
        }),
      ).toBeVisible();

      await choose(
        dealCard(page, wonTitle),
        `Move "${wonTitle}" to a different stage`,
        "Proposal",
      );
      await expect(
        stageColumn(page, "Proposal").getByRole("link", {
          name: wonTitle,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        stageColumn(page, "New").getByRole("link", {
          name: wonTitle,
          exact: true,
        }),
      ).toHaveCount(0);

      await page.getByRole("link", { name: wonTitle, exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/crm\/deals\/[0-9a-f-]+$/);
      await expectNoApplicationError(page);
      await expect(
        page
          .getByText("Stage", { exact: true })
          .locator("xpath=following-sibling::span"),
      ).toHaveText("Proposal");

      await page.getByLabel("Value").fill("4321.09");
      await page.getByLabel("Probability % (optional)").fill("65");
      await page.getByLabel("Expected close date").fill("2030-06-15");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("$4,321.09", { exact: true })).toBeVisible();
      await expect(page.getByText("65%", { exact: true })).toBeVisible();
      await expect(page.getByText(/Jun 15, 2030/)).toBeVisible();

      await choose(page, "Deal owner", "Platform Owner (Dev)");
      await expect(
        page
          .getByText("Owner", { exact: true })
          .locator("xpath=following-sibling::span"),
      ).toHaveText("Platform Owner (Dev)");

      await page.getByRole("button", { name: "Mark won" }).click();
      await expect(
        page.getByText("WON", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Reopen deal" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Mark lost" })).toHaveCount(
        0,
      );

      await page.getByRole("button", { name: "Reopen deal" }).click();
      await expect(
        page.getByText("OPEN", { exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByLabel("Stage")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Mark won" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Mark lost" }),
      ).toBeVisible();

      await page.getByLabel("Note").fill(note);
      await page.getByRole("button", { name: "Add note" }).click();
      await expect(page.getByText(note, { exact: true })).toBeVisible();
      await expect(
        page.getByText("created this deal", { exact: true }),
      ).toBeVisible();

      await goto(page, "/admin/crm/pipeline");
      await page.getByLabel("Title").fill(lostTitle);
      await choose(page, "Company", "Acme Retail Group");
      await page.getByRole("button", { name: "Create deal" }).click();
      await expect(
        stageColumn(page, "New").getByRole("link", {
          name: lostTitle,
          exact: true,
        }),
      ).toBeVisible();
      await choose(
        dealCard(page, lostTitle),
        `Move "${lostTitle}" to a different stage`,
        "Qualifying",
      );
      await expect(
        stageColumn(page, "Qualifying").getByRole("link", {
          name: lostTitle,
          exact: true,
        }),
      ).toBeVisible();
      await page.getByRole("link", { name: lostTitle, exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/crm\/deals\/[0-9a-f-]+$/);
      await expectNoApplicationError(page);

      await page.getByRole("button", { name: "Mark lost" }).click();
      await expect(
        page.getByRole("button", { name: "Confirm lost" }),
      ).toBeDisabled();
      await page.getByLabel("Loss reason").fill(lossReason);
      await page.getByRole("button", { name: "Confirm lost" }).click();
      await expect(
        page.getByText("LOST", { exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByText(lossReason, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Reopen deal" }),
      ).toBeVisible();
    },
  );
});

base.describe("Sales Pipeline — lead conversion and settings", () => {
  base(
    "platform admin converts a freshly-created qualified lead to a deal",
    async ({ page }) => {
      base.setTimeout(60_000);
      // A fresh lead, not the shared seeded QUALIFIED fixture — CONVERTED
      // is a terminal, one-way lead status (see `crm-lead-service.ts`'s
      // own state machine), so consuming the one seeded QUALIFIED lead
      // here would make this test pass exactly once per database and
      // then fail on every subsequent run. Create-and-advance-via-the-UI
      // instead, the same "create fresh data for anything you mutate"
      // discipline the rest of this file already follows.
      const uniqueId = `${Date.now()}`;
      const leadTitle = `[${uniqueId}] E2E conversion-ready lead`;

      await loginAs(page, "platform-admin@alpha-os.test");
      await expectNoApplicationError(page);
      await goto(page, "/admin/crm/leads");
      await page.getByLabel("Title").fill(leadTitle);
      await choose(page, "Company", "Acme Retail Group");
      await page.getByRole("button", { name: "Create lead" }).click();
      await page.getByRole("link", { name: leadTitle, exact: true }).click();
      await expectNoApplicationError(page);
      await page.getByRole("button", { name: "Mark contacted" }).click();
      await expect(page.getByText("CONTACTED", { exact: true }).first()).toBeVisible();
      await page.getByRole("button", { name: "Mark qualified" }).click();
      await expect(page.getByText("QUALIFIED", { exact: true }).first()).toBeVisible();

      await expect(
        page.getByRole("heading", { name: "Convert to deal", exact: true }),
      ).toBeVisible();
      await choose(page, "Pipeline", "Sales Pipeline");
      await page.getByRole("button", { name: "Convert to deal" }).click();
      await page.waitForURL(/\/admin\/crm\/deals\/[0-9a-f-]+$/, {
        timeout: 15_000,
      });
      await expectNoApplicationError(page);
      await expect(
        page.getByRole("heading", { name: leadTitle, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Acme Retail Group", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "View lead", exact: true }),
      ).toBeVisible();
    },
  );

  base(
    "platform admin creates, reorders, and archives stages in a fresh pipeline",
    async ({ page }) => {
      base.setTimeout(90_000);
      const uniqueId = `${Date.now()}`;
      const pipelineName = `[${uniqueId}] E2E Pipeline`;
      const customStage = `[${uniqueId}] E2E Review`;

      await loginAs(page, "platform-admin@alpha-os.test");
      await expectNoApplicationError(page);
      await goto(page, "/admin/crm/settings");
      await expect(
        page.getByRole("heading", { name: "Sales pipelines", exact: true }),
      ).toBeVisible();
      await page.getByLabel("New pipeline").fill(pipelineName);
      await page.getByRole("button", { name: "Add pipeline" }).click();

      const pipelineCard = page
        .getByText(pipelineName, { exact: true })
        .locator("xpath=ancestor::div[@data-slot='card']");
      await expect(pipelineCard).toBeVisible();
      await expect(
        pipelineCard.getByText("New", { exact: true }),
      ).toBeVisible();
      await expect(
        pipelineCard.getByText("Closed Lost", { exact: true }),
      ).toBeVisible();

      await pipelineCard.getByLabel("New stage").fill(customStage);
      await pipelineCard.getByRole("button", { name: "Add stage" }).click();
      await expect(
        pipelineCard.getByText(customStage, { exact: true }),
      ).toBeVisible();

      let customStageRow = pipelineCard
        .getByText(customStage, { exact: true })
        .locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]");
      await expect(
        customStageRow.locator("xpath=preceding-sibling::div[1]"),
      ).toContainText("Closed Lost");
      await pipelineCard
        .getByRole("button", { name: `Move ${customStage} earlier` })
        .click();
      customStageRow = pipelineCard
        .getByText(customStage, { exact: true })
        .locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]");
      await expect(
        customStageRow.locator("xpath=preceding-sibling::div[1]"),
      ).toContainText("Closed Won");
      await expect(
        customStageRow.locator("xpath=following-sibling::div[1]"),
      ).toContainText("Closed Lost");

      await customStageRow
        .getByRole("button", { name: "Archive", exact: true })
        .click();
      await expect(
        pipelineCard.getByText(customStage, { exact: true }),
      ).toHaveCount(0);
    },
  );
});

base.describe(
  "Sales Pipeline — forecast, denial, and responsive behavior",
  () => {
    base("forecast cards render real currency content", async ({ page }) => {
      await loginAs(page, "platform-owner@alpha-os.test");
      await expectNoApplicationError(page);
      await goto(page, "/admin/crm/pipeline");

      for (const label of [
        "Pipeline value",
        "Weighted forecast",
        "Expected closing",
        "Won this period",
      ]) {
        const card = page
          .getByText(label, { exact: true })
          .locator("xpath=ancestor::div[@data-slot='card']");
        await expect(card).toBeVisible();
        await expect(
          card.getByText(/^\$[\d,]+(?:\.\d{2})?$/).first(),
        ).toBeVisible();
      }
    });

    base(
      "a nonexistent deal shows not found without an application crash",
      async ({ page }) => {
        await loginAs(page, "platform-owner@alpha-os.test");
        await expectNoApplicationError(page);
        await goto(page, `/admin/crm/deals/${MISSING_ID}`);
        await expect(page.getByText("404")).toBeVisible();
      },
    );

    base(
      "the board remains usable at mobile and tablet widths",
      async ({ page }) => {
        await loginAs(page, "platform-owner@alpha-os.test");
        await expectNoApplicationError(page);

        for (const viewport of [
          { width: 375, height: 812 },
          { width: 768, height: 1024 },
        ]) {
          await page.setViewportSize(viewport);
          await goto(page, "/admin/crm/pipeline");
          await expect(
            page.getByRole("heading", { name: "Sales Pipeline", exact: true }),
          ).toBeVisible();
          const board = page.getByRole("region", {
            name: "Sales pipeline board, scrollable on narrow viewports",
          });
          await expect(board).toBeVisible();
          const moveSelect = board.getByLabel(
            'Move "Technical SEO retainer — Globex Logistics" to a different stage',
          );
          await expect(moveSelect).toBeVisible();
          await expect(moveSelect).toBeEnabled();
          if (viewport.width === 375) {
            await moveSelect.click();
            await expect(
              page.getByRole("option", { name: "Proposal", exact: true }),
            ).toBeVisible();
            await page.keyboard.press("Escape");
          }
        }
      },
    );
  },
);
