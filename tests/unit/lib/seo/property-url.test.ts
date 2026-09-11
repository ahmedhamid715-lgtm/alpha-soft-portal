import { describe, it, expect } from "vitest";
import { normalizePropertyUrl, InvalidPropertyUrlError, urlBelongsToOrigin } from "@/lib/seo/property-url";

describe("normalizePropertyUrl", () => {
  it("normalizes a bare https URL", () => {
    const result = normalizePropertyUrl("https://Example.com");
    expect(result.normalizedOrigin).toBe("https://example.com");
    expect(result.displayUrl).toBe("https://Example.com");
  });

  it("strips a path/query/fragment from the canonical identity but preserves the entered URL", () => {
    const result = normalizePropertyUrl("https://example.com/pricing?ref=ad#top");
    expect(result.normalizedOrigin).toBe("https://example.com");
    expect(result.displayUrl).toBe("https://example.com/pricing?ref=ad#top");
  });

  it("strips the default port for the scheme", () => {
    expect(normalizePropertyUrl("https://example.com:443").normalizedOrigin).toBe("https://example.com");
    expect(normalizePropertyUrl("http://example.com:80").normalizedOrigin).toBe("http://example.com");
  });

  it("preserves a non-default port", () => {
    expect(normalizePropertyUrl("https://example.com:8443").normalizedOrigin).toBe("https://example.com:8443");
  });

  it("treats www and non-www as different origins — never silently merged", () => {
    const bare = normalizePropertyUrl("https://example.com");
    const www = normalizePropertyUrl("https://www.example.com");
    expect(bare.normalizedOrigin).not.toBe(www.normalizedOrigin);
  });

  it("treats http and https as different origins — never silently merged", () => {
    const http = normalizePropertyUrl("http://example.com");
    const https = normalizePropertyUrl("https://example.com");
    expect(http.normalizedOrigin).not.toBe(https.normalizedOrigin);
  });

  it("rejects an empty string", () => {
    expect(() => normalizePropertyUrl("")).toThrow(InvalidPropertyUrlError);
    expect(() => normalizePropertyUrl("   ")).toThrow(InvalidPropertyUrlError);
  });

  it("rejects a malformed URL", () => {
    expect(() => normalizePropertyUrl("not a url")).toThrow(InvalidPropertyUrlError);
  });

  it("rejects a bare domain with no scheme", () => {
    expect(() => normalizePropertyUrl("example.com")).toThrow(InvalidPropertyUrlError);
  });

  it("rejects an unsupported scheme", () => {
    expect(() => normalizePropertyUrl("ftp://example.com")).toThrow(InvalidPropertyUrlError);
    expect(() => normalizePropertyUrl("javascript:alert(1)")).toThrow(InvalidPropertyUrlError);
  });
});

describe("urlBelongsToOrigin", () => {
  it("returns true for a URL on the same origin, regardless of path", () => {
    expect(urlBelongsToOrigin("https://example.com/blog/post-1", "https://example.com")).toBe(true);
  });

  it("returns false for a different origin", () => {
    expect(urlBelongsToOrigin("https://evil.com/blog/post-1", "https://example.com")).toBe(false);
    expect(urlBelongsToOrigin("https://www.example.com/", "https://example.com")).toBe(false);
  });

  it("returns false for a malformed URL rather than throwing", () => {
    expect(urlBelongsToOrigin("not a url", "https://example.com")).toBe(false);
  });
});
