import { describe, expect, it } from "vitest";
import { assertNoSecretLikeContent, SuspectedSecretContentError } from "@/lib/security/secret-guard";

describe("assertNoSecretLikeContent (WDEV-SEC-01 remediation, shared cross-domain in Build 33)", () => {
  it("does nothing for null/undefined/empty input", () => {
    expect(() => assertNoSecretLikeContent(null, "notes")).not.toThrow();
    expect(() => assertNoSecretLikeContent(undefined, "notes")).not.toThrow();
    expect(() => assertNoSecretLikeContent("", "notes")).not.toThrow();
  });

  it("does nothing for ordinary prose, even prose that mentions a sensitive word in passing", () => {
    expect(() => assertNoSecretLikeContent("Uses an API key for analytics tracking.", "notes")).not.toThrow();
    expect(() => assertNoSecretLikeContent("Built on WordPress with a custom theme.", "notes")).not.toThrow();
    expect(() => assertNoSecretLikeContent("Client asked about SSH access setup timeline.", "notes")).not.toThrow();
    expect(() => assertNoSecretLikeContent("Uses Shopify's own consumer API for the storefront.", "notes")).not.toThrow();
    expect(() => assertNoSecretLikeContent("Uses token-based authentication for the checkout flow.", "notes")).not.toThrow();
    expect(() => assertNoSecretLikeContent("Requires a valid credential before checkout — no value stored here.", "notes")).not.toThrow();
  });

  it.each([
    "Password: hunter2",
    "password=hunter2",
    "API key: sk_live_abc123",
    "apikey=abc123",
    "ACCESS_KEY: AKIA...",
    "Private Key: -----BEGIN...",
    "ssh-password: secret",
    "ftp_password=secret",
    "database password: secret",
    "db_password=secret",
    "Auth token: eyJhbGciOi",
    "Bearer: abc.def.ghi",
    "Consumer secret: ck_abc123",
    "Webhook secret: whsec_abc123",
    // Build 33 Codex Security Engineer finding ECOM-SEC-01 — a bare
    // "access token"/"refresh token" label (no "auth"/"bearer" prefix)
    // previously passed through unscreened.
    "Access token: shpat_abc123",
    "refresh_token=abc123",
    "Shopify token: shpat_abc123",
    "shopifyToken: shpat_abc123",
    "Woocommerce secret: ck_abc123",
    "woocommerceSecret=ck_abc123",
    "Credential: shpat_abc123",
  ])("rejects a credential-labeled value: %s", (value) => {
    expect(() => assertNoSecretLikeContent(value, "notes")).toThrow(SuspectedSecretContentError);
  });

  it.each([
    // Build 34 Codex Security Engineer finding GHL-SEC-01 — a glued
    // label this domain specifically needs, plus unlabeled provider
    // credential shapes that no label-based check alone can catch.
    "pitToken=abc12345",
    "pit_token: abc12345",
    "sk_live_51ExampleSecretKey12345",
    "sk_test_51ExampleSecretKey12345",
    "rk_live_51ExampleRestrictedKey1",
    "whsec_abcdefgh12345678",
    "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "key-1234567890abcdef1234567890abcdef",
    "https://example.invalid/?pitToken=abc12345",
    "Notes: paste the key here sk_live_51ExampleSecretKey12345 for reference",
  ])("rejects a GHL-SEC-01 provider-secret form: %s", (value) => {
    expect(() => assertNoSecretLikeContent(value, "notes")).toThrow(SuspectedSecretContentError);
  });

  it("still allows ordinary prose that merely resembles but does not match a provider-secret shape", () => {
    expect(() => assertNoSecretLikeContent("The account SID starts with AC and the workspace ID is separate.", "notes")).not.toThrow();
    expect(() => assertNoSecretLikeContent("Client's GoHighLevel location key is stored in their own vault, not here.", "notes")).not.toThrow();
  });

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
