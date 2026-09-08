import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";
import { serverIsReachable } from "./fixtures";

/**
 * Client Onboarding accessibility coverage (Build 23 — Roadmap Module
 * 17) — direct style/helper template from
 * `proposals-contracts-accessibility.spec.ts`. Written directly by
 * Claude, same reasoning as `client-onboarding.spec.ts`'s own top
 * comment.
 *
 * Logs in ONCE for the whole file (`beforeAll`, one shared
 * context/page), not once per test. Found live: 10 tests here × 1 login
 * each, on top of `client-onboarding.spec.ts`'s own logins in the same
 * suite run, exceeds `authRateLimiter`'s real 10-attempts/15-minute cap
 * (`src/lib/platform/rate-limit.ts`) and starts failing with a login
 * timeout partway through — the exact "login rate limiter affects
 * repeated E2E" scenario the Build 23 authorization anticipated. The fix
 * is a real authenticated-session helper (one login, reused), not
 * loosening the limiter — accessibility scans don't need a fresh session
 * per scan, so sharing one is legitimate here.
 */
let context: BrowserContext;
let page: Page;

base.beforeAll(async ({ browser, baseURL }) => {
  const reachable = await serverIsReachable(baseURL ?? "http://localhost:3000");
  base.skip(!reachable, `App not reachable at ${baseURL} — see playwright.config.ts.`);

  context = await browser.newContext();
  page = await context.newPage();
  await loginAs(page, "platform-admin@alpha-os.test");
});

base.afterAll(async () => {
  await context?.close();
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

async function seededOnboardingId(): Promise<string | undefined> {
  return withPgClient((client) => client.query("SELECT id FROM crm_client_onboardings LIMIT 1").then((r) => r.rows[0]?.id as string | undefined));
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

/** See `proposals-contracts-accessibility.spec.ts`'s own identical constant/comment — STILL DEFERRED for the exact reason `proposals-contracts.md`/`client-onboarding.md` "Accessibility" document. */
const KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS = ["aria-hidden-focus", "landmark-one-main", "page-has-heading-one", "region"];

/**
 * Waits out the shared `Button` component's own `transition-all`
 * (`src/components/ui/button.tsx`) before scanning — found live: filling
 * a required field flips a submit button from `disabled` (which applies
 * `disabled:opacity-50`) to enabled, and axe-core reads the REAL,
 * currently-rendered computed style, not the button's eventual settled
 * state. Scanning in the same tick as the fill can catch the opacity
 * mid-transition (still ~0.5, animating toward 1), which genuinely
 * measures as a WCAG contrast failure — a false positive from scanning
 * an animation frame, not a real defect a user would ever perceive (the
 * button is at full opacity within ~150ms and stays there). Verified
 * directly: `getComputedStyle(button).opacity` read immediately after
 * `.fill()` measured `0.5` even though `disabled` was already `false`.
 */
async function settleAnimations(page: Page): Promise<void> {
  await page.waitForTimeout(250);
}

async function scan(page: Page, excludeRuleIds: string[] = []) {
  await settleAnimations(page);
  const builder = new AxeBuilder({ page });
  if (excludeRuleIds.length > 0) builder.disableRules(excludeRuleIds);
  const results = await builder.analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

base.describe("Client Onboarding accessibility (Module 17)", () => {
  base("list, detail, and intake-fields pages have no axe violations on desktop in either theme", async () => {
    const onboardingId = await seededOnboardingId();
    await page.setViewportSize(VIEWPORTS.desktop);

    for (const scheme of ["light", "dark"] as const) {
      await setColorScheme(page, scheme);
      const paths = ["/admin/crm/onboarding", "/admin/crm/onboarding/intake-fields"];
      if (onboardingId) paths.push(`/admin/crm/onboarding/${onboardingId}`);
      for (const path of paths) {
        await goto(page, path);
        await expect(page.getByRole("main")).toBeVisible();
        await scan(page);
      }
    }
  });

  base("the checklist/requirements/documents interactive states have no axe violations", async () => {
    const onboardingId = await seededOnboardingId();
    base.skip(!onboardingId, "No seeded onboarding found.");
    await setColorScheme(page, "dark");
    await goto(page, `/admin/crm/onboarding/${onboardingId}`);

    await page.getByLabel("Add item").fill("Accessibility scan item");
    await page.getByLabel("Add requirement").fill("Accessibility scan requirement");
    await scan(page);
  });

  base("open Select controls on the onboarding workspace have no axe violations outside the known platform limitation", async () => {
    const onboardingId = await seededOnboardingId();
    base.skip(!onboardingId, "No seeded onboarding found.");
    await setColorScheme(page, "dark");
    await goto(page, `/admin/crm/onboarding/${onboardingId}`);

    await page.getByLabel("Status", { exact: true }).click();
    await expect(page.getByRole("option").first()).toBeVisible();
    await scan(page, KNOWN_PLATFORM_SELECT_OPEN_RULE_IDS);
  });

  base("the intake-fields catalog form has no axe violations", async () => {
    await setColorScheme(page, "dark");
    await goto(page, "/admin/crm/onboarding/intake-fields");
    await page.getByLabel("Label").fill("Accessibility scan field");
    await scan(page);
  });

  for (const scheme of ["light", "dark"] as const) {
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      base(`Onboarding list has no axe violations (${scheme}, ${viewportName})`, async () => {
        await page.setViewportSize(viewport);
        await setColorScheme(page, scheme);
        await goto(page, "/admin/crm/onboarding");
        await scan(page);
      });
    }
  }
});
