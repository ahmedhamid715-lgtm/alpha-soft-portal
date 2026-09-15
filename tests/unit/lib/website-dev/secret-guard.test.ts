import { describe, expect, it } from "vitest";
import { assertNoSecretLikeContent, SuspectedSecretContentError } from "@/lib/website-dev/secret-guard";

describe("assertNoSecretLikeContent (WDEV-SEC-01 remediation)", () => {
  it("does nothing for null/undefined/empty input", () => {
    expect(() => assertNoSecretLikeContent(null, "notes")).not.toThrow();
    expect(() => assertNoSecretLikeContent(undefined, "notes")).not.toThrow();
    expect(() => assertNoSecretLikeContent("", "notes")).not.toThrow();
  });

  it("does nothing for ordinary prose, even prose that mentions a sensitive word in passing", () => {
    expect(() => assertNoSecretLikeContent("Uses an API key for analytics tracking.", "notes")).not.toThrow();
    expect(() => assertNoSecretLikeContent("Built on WordPress with a custom theme.", "notes")).not.toThrow();
    expect(() => assertNoSecretLikeContent("Client asked about SSH access setup timeline.", "notes")).not.toThrow();
  });

  it.each(["Password: hunter2", "password=hunter2", "API key: sk_live_abc123", "apikey=abc123", "ACCESS_KEY: AKIA...", "Private Key: -----BEGIN...", "ssh-password: secret", "ftp_password=secret", "database password: secret", "db_password=secret", "Auth token: eyJhbGciOi", "Bearer: abc.def.ghi"])(
    "rejects a credential-labeled value: %s",
    (value) => {
      expect(() => assertNoSecretLikeContent(value, "notes")).toThrow(SuspectedSecretContentError);
    },
  );

  it("includes the field label in the thrown error so the caller can report which field was rejected", () => {
    try {
      assertNoSecretLikeContent("password: secret", "Deployment notes");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SuspectedSecretContentError);
      expect((error as SuspectedSecretContentError).fieldLabel).toBe("Deployment notes");
      expect((error as Error).message).toContain("Deployment notes");
    }
  });
});
