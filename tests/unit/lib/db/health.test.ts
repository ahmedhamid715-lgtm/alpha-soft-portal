import { describe, expect, it } from "vitest";
import { checkDatabaseHealth } from "@/lib/db/health";

/**
 * This test suite deliberately runs against whatever database state the
 * test environment actually has — no mocking of Prisma. In this
 * environment (see docs/architecture/database.md) no DATABASE_URL is
 * configured, so the "unavailable" path is exercised for real, not
 * simulated. Once Module 03 adds a real test database, add a companion
 * test for the "healthy" path rather than replacing this one — both
 * states are worth covering.
 */
describe("checkDatabaseHealth", () => {
  it("reports unavailable, with a safe message, when DATABASE_URL is not configured", async () => {
    const result = await checkDatabaseHealth();

    if (!process.env.DATABASE_URL) {
      expect(result.status).toBe("unavailable");
      expect(result.message).toBe("DATABASE_URL is not configured.");
      // The safe message must never contain connection details.
      expect(JSON.stringify(result)).not.toMatch(/postgres(ql)?:\/\//);
    } else {
      // A real DATABASE_URL is configured in this environment — just
      // assert the result is well-formed rather than assuming a status.
      expect(["healthy", "degraded", "unavailable"]).toContain(result.status);
    }
  });
});
