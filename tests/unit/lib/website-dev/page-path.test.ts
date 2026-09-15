import { describe, it, expect } from "vitest";
import { normalizeWebsitePagePath, InvalidWebsitePagePathError } from "@/lib/website-dev/page-path";

describe("normalizeWebsitePagePath", () => {
  it("accepts the root path unchanged", () => {
    expect(normalizeWebsitePagePath("/")).toBe("/");
  });

  it("accepts a nested path and strips a trailing slash", () => {
    expect(normalizeWebsitePagePath("/services/seo/")).toBe("/services/seo");
  });

  it("trims whitespace", () => {
    expect(normalizeWebsitePagePath("  /about  ")).toBe("/about");
  });

  it("rejects a path with no leading slash", () => {
    expect(() => normalizeWebsitePagePath("about")).toThrow(InvalidWebsitePagePathError);
  });

  it("rejects a query string or fragment", () => {
    expect(() => normalizeWebsitePagePath("/about?x=1")).toThrow(InvalidWebsitePagePathError);
    expect(() => normalizeWebsitePagePath("/about#section")).toThrow(InvalidWebsitePagePathError);
  });

  it("rejects consecutive slashes", () => {
    expect(() => normalizeWebsitePagePath("//about")).toThrow(InvalidWebsitePagePathError);
  });

  it("rejects disallowed characters", () => {
    expect(() => normalizeWebsitePagePath("/about<script>")).toThrow(InvalidWebsitePagePathError);
    expect(() => normalizeWebsitePagePath("/about page")).toThrow(InvalidWebsitePagePathError);
  });

  it("rejects an empty value", () => {
    expect(() => normalizeWebsitePagePath("   ")).toThrow(InvalidWebsitePagePathError);
  });

  it("rejects literal '.'/'..' path segments (WDEV-SEC-04)", () => {
    expect(() => normalizeWebsitePagePath("/../admin")).toThrow(InvalidWebsitePagePathError);
    expect(() => normalizeWebsitePagePath("/a/../b")).toThrow(InvalidWebsitePagePathError);
    expect(() => normalizeWebsitePagePath("/a/../../b")).toThrow(InvalidWebsitePagePathError);
    expect(() => normalizeWebsitePagePath("/./about")).toThrow(InvalidWebsitePagePathError);
  });

  it("still accepts a legitimate dot inside a segment, e.g. a filename-like path", () => {
    expect(normalizeWebsitePagePath("/sitemap.xml")).toBe("/sitemap.xml");
    expect(normalizeWebsitePagePath("/v1.2/about")).toBe("/v1.2/about");
  });
});
