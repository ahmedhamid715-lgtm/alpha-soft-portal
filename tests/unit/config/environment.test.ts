import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/config/environment.ts` validates `process.env` at MODULE LOAD
 * time, not lazily — that's the whole point (fail fast at boot, not on
 * the third request). Testing that means controlling `process.env` before
 * import and forcing a fresh module evaluation per test via
 * `vi.resetModules()` + dynamic `import()`, since a normal top-level
 * import would only ever run the validation once, against whatever
 * `process.env` looked like the first time any test file imported it.
 */
describe("server environment validation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("boots successfully with no optional variables set", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.AUTH_SECRET;
    delete process.env.ANTHROPIC_API_KEY;

    const { serverEnv, isDatabaseConfigured, isAnthropicConfigured } = await import("@/config/environment");

    expect(serverEnv.NODE_ENV).toBeDefined();
    expect(serverEnv.LOG_LEVEL).toBe("info");
    expect(isDatabaseConfigured).toBe(false);
    expect(isAnthropicConfigured).toBe(false);
  });

  it("accepts a valid DATABASE_URL and reports the database as configured", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

    const { serverEnv, isDatabaseConfigured } = await import("@/config/environment");

    expect(serverEnv.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db");
    expect(isDatabaseConfigured).toBe(true);
  });

  it("throws with a readable message when DATABASE_URL is not a valid URL", async () => {
    process.env.DATABASE_URL = "not-a-url";

    await expect(import("@/config/environment")).rejects.toThrow(/Invalid or missing environment configuration/);
  });

  it("throws when LOG_LEVEL is set to an unsupported value", async () => {
    process.env.LOG_LEVEL = "verbose";

    await expect(import("@/config/environment")).rejects.toThrow(/LOG_LEVEL/);
  });

  it("throws when AUTH_SECRET is present but too short", async () => {
    process.env.AUTH_SECRET = "too-short";

    await expect(import("@/config/environment")).rejects.toThrow();
  });
});
