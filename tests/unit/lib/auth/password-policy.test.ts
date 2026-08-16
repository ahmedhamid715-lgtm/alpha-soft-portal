import { describe, expect, it } from "vitest";
import { passwordSchema, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "@/lib/auth/password-policy";

describe("passwordSchema", () => {
  it(`rejects a password shorter than ${PASSWORD_MIN_LENGTH} characters`, () => {
    const result = passwordSchema.safeParse("a".repeat(PASSWORD_MIN_LENGTH - 1));
    expect(result.success).toBe(false);
  });

  it(`accepts a password exactly ${PASSWORD_MIN_LENGTH} characters long`, () => {
    expect(passwordSchema.safeParse("a".repeat(PASSWORD_MIN_LENGTH)).success).toBe(true);
  });

  it(`rejects a password longer than ${PASSWORD_MAX_LENGTH} characters`, () => {
    expect(passwordSchema.safeParse("a".repeat(PASSWORD_MAX_LENGTH + 1)).success).toBe(false);
  });

  it("has no composition requirements — a long passphrase of only lowercase letters is valid", () => {
    // Deliberate — see password.ts: length-based policy, not mandatory
    // symbol/number/uppercase rules (current NIST/OWASP guidance).
    expect(passwordSchema.safeParse("correcthorsebatterystaple").success).toBe(true);
  });

  it("accepts unicode characters (no ASCII-only restriction)", () => {
    expect(passwordSchema.safeParse("pässwörd-with-ünicode-chars").success).toBe(true);
  });

  it("does not trim or otherwise transform the value", () => {
    const withSpaces = "  padded password with spaces  ";
    const result = passwordSchema.safeParse(withSpaces);
    expect(result.success && result.data).toBe(withSpaces);
  });
});
