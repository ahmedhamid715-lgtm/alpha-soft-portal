import { describe, it, expect } from "vitest";
import { normalizeWebsiteUrl, isHttpUrl, InvalidWebsiteUrlError } from "@/lib/website-dev/url";

describe("normalizeWebsiteUrl", () => {
  it("treats www and non-www as the SAME site identity — deliberately different from SEO OS's own property-url.ts rule", () => {
    expect(normalizeWebsiteUrl("https://www.example.com").normalizedOrigin).toBe(normalizeWebsiteUrl("https://example.com").normalizedOrigin);
  });

  it("preserves the original display URL verbatim (trimmed only)", () => {
    const result = normalizeWebsiteUrl("  https://www.example.com/  ");
    expect(result.displayUrl).toBe("https://www.example.com/");
  });

  it("lowercases the host and strips a default port", () => {
    expect(normalizeWebsiteUrl("https://EXAMPLE.com:443").normalizedOrigin).toBe("https://example.com");
  });

  it("keeps a non-default port as a distinct origin", () => {
    expect(normalizeWebsiteUrl("https://example.com:8443").normalizedOrigin).toBe("https://example.com:8443");
  });

  it("rejects javascript:/data:/file: schemes", () => {
    expect(() => normalizeWebsiteUrl("javascript:alert(1)")).toThrow(InvalidWebsiteUrlError);
    expect(() => normalizeWebsiteUrl("data:text/html,x")).toThrow(InvalidWebsiteUrlError);
    expect(() => normalizeWebsiteUrl("file:///etc/passwd")).toThrow(InvalidWebsiteUrlError);
  });

  it("rejects a bare host with no scheme", () => {
    expect(() => normalizeWebsiteUrl("example.com")).toThrow(InvalidWebsiteUrlError);
  });

  it("rejects an empty value", () => {
    expect(() => normalizeWebsiteUrl("   ")).toThrow(InvalidWebsiteUrlError);
  });
});

describe("isHttpUrl", () => {
  it("accepts http/https only", () => {
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});
