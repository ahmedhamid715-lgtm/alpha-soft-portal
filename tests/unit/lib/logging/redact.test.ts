import { describe, expect, it } from "vitest";
import { redact } from "@/lib/logging/redact";

describe("redact", () => {
  it("redacts a top-level sensitive key", () => {
    const result = redact({ password: "hunter2", username: "alice" }) as Record<string, unknown>;
    expect(result.password).toBe("[redacted]");
    expect(result.username).toBe("alice");
  });

  it("redacts sensitive keys regardless of nesting depth", () => {
    const result = redact({
      user: { profile: { credentials: { apiKey: "sk-secret" } } },
    }) as { user: { profile: { credentials: { apiKey: string } } } };
    expect(result.user.profile.credentials.apiKey).toBe("[redacted]");
  });

  it("matches case-insensitively and with common separators", () => {
    const result = redact({ PASSWORD_HASH: "x", "session-id": "y", authToken: "z" }) as Record<string, unknown>;
    expect(result.PASSWORD_HASH).toBe("[redacted]");
    expect(result["session-id"]).toBe("[redacted]");
    expect(result.authToken).toBe("[redacted]");
  });

  it("leaves non-sensitive values untouched", () => {
    const result = redact({ requestId: "abc-123", operation: "tickets.create" }) as Record<string, unknown>;
    expect(result).toEqual({ requestId: "abc-123", operation: "tickets.create" });
  });

  it("redacts within arrays", () => {
    const result = redact([{ token: "abc" }, { token: "def" }]) as Array<Record<string, unknown>>;
    expect(result[0].token).toBe("[redacted]");
    expect(result[1].token).toBe("[redacted]");
  });

  it("passes primitives through unchanged", () => {
    expect(redact("hello")).toBe("hello");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
  });

  it("serializes Date values to ISO strings", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(redact({ createdAt: date })).toEqual({ createdAt: "2026-01-01T00:00:00.000Z" });
  });
});
