import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static check for spec section 20 (server/client boundaries) and 38
 * (security tests: "secret separation, server-only modules"). This can't
 * be verified by actually building a client bundle in a Vitest run — that
 * protection is enforced by Next.js's compiler, not by this test suite —
 * so instead this asserts the *source-level contract*: every module that
 * touches a secret, the database, or another server-only capability
 * declares `import "server-only"` as its first real statement. If a
 * future PR removes that import from one of these files, this test
 * catches it before Next's build would (and before it would matter,
 * i.e. before someone actually imports it from a client component).
 */
const SERVER_ONLY_FILES = [
  "src/config/environment.ts",
  "src/lib/db/client.ts",
  "src/lib/db/errors.ts",
  "src/lib/db/transaction.ts",
  "src/lib/db/health.ts",
  "src/lib/errors/api-response.ts",
  "src/lib/logging/index.ts",
  "src/lib/platform/rate-limit.ts",
  "src/lib/platform/storage.ts",
  "src/lib/platform/jobs.ts",
  "src/lib/platform/events.ts",
  "src/lib/platform/search.ts",
  "src/lib/platform/feature-flags.ts",
  "src/lib/platform/route-handler.ts",
];

describe("server/client boundary", () => {
  it.each(SERVER_ONLY_FILES)("%s declares import \"server-only\"", (relativePath) => {
    const contents = readFileSync(path.resolve(process.cwd(), relativePath), "utf-8");
    expect(contents).toMatch(/import\s+"server-only"/);
  });

  it("environment.public.ts does NOT import server-only (it must stay client-safe)", () => {
    const contents = readFileSync(path.resolve(process.cwd(), "src/config/environment.public.ts"), "utf-8");
    expect(contents).not.toMatch(/import\s+"server-only"/);
  });

  it("app-error.ts does NOT import server-only (thrown/caught from both sides)", () => {
    const contents = readFileSync(path.resolve(process.cwd(), "src/lib/errors/app-error.ts"), "utf-8");
    expect(contents).not.toMatch(/import\s+"server-only"/);
  });

  /**
   * config/app.ts is imported from client components (e.g. AppSidebar, for
   * `appConfig.name`) — it must stay import-clean of `./environment`
   * (server-only) even transitively. This regressed once already: Module
   * 01 imported `serverEnv` there for `appConfig.environment`, which was
   * harmless until Module 02's first client component imported `appConfig`
   * and Next.js's build correctly failed. Fixed by reading
   * `process.env.NODE_ENV` directly instead (Next.js inlines it
   * identically into both bundles). Catch it here instead of at build time.
   */
  it("config/app.ts does NOT import the server-only environment module", () => {
    const contents = readFileSync(path.resolve(process.cwd(), "src/config/app.ts"), "utf-8");
    expect(contents).not.toMatch(/from\s+["']\.\/environment["']/);
    expect(contents).not.toMatch(/import\s+"server-only"/);
  });
});
