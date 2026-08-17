import { describe, expect, it } from "vitest";
import { redactAuditValue, redactAuditObject } from "@/lib/audit/redact";

describe("redactAuditValue", () => {
  it("redacts a top-level sensitive key", () => {
    const result = redactAuditValue({ password: "hunter2", email: "a@b.com" }) as Record<string, unknown>;
    expect(result.password).toBe("[redacted]");
    expect(result.email).toBe("a@b.com");
  });

  it("redacts sensitive keys regardless of nesting depth", () => {
    const result = redactAuditValue({ user: { profile: { credentials: { apiKey: "sk-secret" } } } }) as {
      user: { profile: { credentials: { apiKey: string } } };
    };
    expect(result.user.profile.credentials.apiKey).toBe("[redacted]");
  });

  it("redacts within arrays", () => {
    const result = redactAuditValue([{ token: "abc" }, { token: "def" }]) as Array<Record<string, unknown>>;
    expect(result[0].token).toBe("[redacted]");
    expect(result[1].token).toBe("[redacted]");
  });

  it("catches the Module-08-specific keys the logging module's redactor doesn't (Phase 10's broader set)", () => {
    const result = redactAuditValue({
      cookie: "session=abc",
      privateKey: "-----BEGIN KEY-----",
      clientSecret: "shh",
      encryptionKey: "k",
      signingKey: "k2",
      cardNumber: "4111111111111111",
      cvv: "123",
    }) as Record<string, unknown>;
    for (const key of Object.keys(result)) {
      expect(result[key]).toBe("[redacted]");
    }
  });

  it("is case-insensitive and matches common separators", () => {
    const result = redactAuditValue({ PASSWORD_HASH: "x", "session-id": "y", authToken: "z" }) as Record<string, unknown>;
    expect(result.PASSWORD_HASH).toBe("[redacted]");
    expect(result["session-id"]).toBe("[redacted]");
    expect(result.authToken).toBe("[redacted]");
  });

  it("does NOT over-redact legitimate business data containing 'key'-adjacent substrings", () => {
    const result = redactAuditValue({
      keyword: "urgent",
      monkeyBusiness: true,
      primaryKey: "not-a-secret-in-this-context",
      keyAccountManager: "Jane",
    }) as Record<string, unknown>;
    expect(result.keyword).toBe("urgent");
    expect(result.monkeyBusiness).toBe(true);
    expect(result.primaryKey).toBe("not-a-secret-in-this-context");
    expect(result.keyAccountManager).toBe("Jane");
  });

  it("does not over-redact plain business fields like 'name', 'role', 'status'", () => {
    const result = redactAuditValue({ name: "Acme Corp", role: "owner", status: "ACTIVE" }) as Record<string, unknown>;
    expect(result).toEqual({ name: "Acme Corp", role: "owner", status: "ACTIVE" });
  });

  it("serializes Date values to ISO strings", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(redactAuditValue({ createdAt: date })).toEqual({ createdAt: "2026-01-01T00:00:00.000Z" });
  });

  it("passes primitives through unchanged", () => {
    expect(redactAuditValue("hello")).toBe("hello");
    expect(redactAuditValue(42)).toBe(42);
    expect(redactAuditValue(null)).toBe(null);
    expect(redactAuditValue(true)).toBe(true);
  });

  it("bounds recursion depth (does not stack-overflow on a deeply nested object)", () => {
    let deep: Record<string, unknown> = { password: "leaf" };
    for (let i = 0; i < 20; i++) {
      deep = { nested: deep };
    }
    expect(() => redactAuditValue(deep)).not.toThrow();
  });
});

describe("redactAuditObject", () => {
  it("passes undefined through unchanged", () => {
    expect(redactAuditObject(undefined)).toBeUndefined();
  });

  it("redacts a defined object", () => {
    const result = redactAuditObject({ token: "abc", name: "ok" });
    expect(result).toEqual({ token: "[redacted]", name: "ok" });
  });
});
