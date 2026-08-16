import { describe, expect, it } from "vitest";
import { generateRawToken, hashToken, tokensMatch } from "@/lib/auth/tokens";

describe("tokens", () => {
  it("generateRawToken produces a URL-safe string with real entropy", () => {
    const token = generateRawToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThan(30); // 32 bytes base64url-encoded
  });

  it("generateRawToken never repeats across calls", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateRawToken()));
    expect(tokens.size).toBe(100);
  });

  it("hashToken is deterministic — the same input always hashes the same way", () => {
    const token = generateRawToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("hashToken produces a 64-character hex digest (SHA-256)", () => {
    expect(hashToken("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashToken output never resembles the input — no accidental reversibility", () => {
    const token = "a-known-raw-token-value";
    expect(hashToken(token)).not.toContain(token);
  });

  it("tokensMatch is true only for identical strings", () => {
    expect(tokensMatch("abc123", "abc123")).toBe(true);
    expect(tokensMatch("abc123", "abc124")).toBe(false);
    expect(tokensMatch("abc123", "abc12")).toBe(false);
  });
});
