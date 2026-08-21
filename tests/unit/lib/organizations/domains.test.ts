import { describe, expect, it } from "vitest";
import { InvalidDomainError, emailMatchesDomain, normalizeDomain, normalizeDomainList } from "@/lib/organizations/domains";

describe("normalizeDomain", () => {
  it("lowercases a valid domain", () => {
    expect(normalizeDomain("Example.COM")).toBe("example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDomain("  example.com  ")).toBe("example.com");
  });

  it("accepts a multi-label domain (subdomain-shaped input listed explicitly)", () => {
    expect(normalizeDomain("mail.example.co.uk")).toBe("mail.example.co.uk");
  });

  it("accepts hyphenated labels", () => {
    expect(normalizeDomain("my-company.com")).toBe("my-company.com");
  });

  it("rejects an empty string", () => {
    expect(() => normalizeDomain("")).toThrow(InvalidDomainError);
    expect(() => normalizeDomain("   ")).toThrow(InvalidDomainError);
  });

  it("rejects a full email address, not just a domain", () => {
    expect(() => normalizeDomain("user@example.com")).toThrow(InvalidDomainError);
  });

  it("rejects a URL with a protocol", () => {
    expect(() => normalizeDomain("https://example.com")).toThrow(InvalidDomainError);
    expect(() => normalizeDomain("http://example.com")).toThrow(InvalidDomainError);
  });

  it("rejects a path", () => {
    expect(() => normalizeDomain("example.com/careers")).toThrow(InvalidDomainError);
  });

  it("rejects wildcard syntax", () => {
    expect(() => normalizeDomain("*.example.com")).toThrow(InvalidDomainError);
  });

  it("rejects a bare label with no dot (not a real domain)", () => {
    expect(() => normalizeDomain("localhost")).toThrow(InvalidDomainError);
  });

  it("rejects invalid characters", () => {
    expect(() => normalizeDomain("exa mple.com")).toThrow(InvalidDomainError);
    expect(() => normalizeDomain("example!.com")).toThrow(InvalidDomainError);
  });

  it("the thrown error carries the original input and a specific reason", () => {
    try {
      normalizeDomain("user@example.com");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidDomainError);
      const e = error as InvalidDomainError;
      expect(e.input).toBe("user@example.com");
      expect(e.reason).toMatch(/email/);
    }
  });
});

describe("normalizeDomainList", () => {
  it("normalizes every entry and preserves order", () => {
    expect(normalizeDomainList(["Example.com", "Other.org"])).toEqual(["example.com", "other.org"]);
  });

  it("dedupes entries that normalize to the same domain", () => {
    expect(normalizeDomainList(["example.com", "Example.COM", "EXAMPLE.COM"])).toEqual(["example.com"]);
  });

  it("throws on the first invalid entry, not silently dropping it", () => {
    expect(() => normalizeDomainList(["example.com", "not valid!", "other.com"])).toThrow(InvalidDomainError);
  });

  it("returns an empty array for an empty input", () => {
    expect(normalizeDomainList([])).toEqual([]);
  });
});

describe("emailMatchesDomain", () => {
  it("matches an email against its exact domain", () => {
    expect(emailMatchesDomain("person@example.com", "example.com")).toBe(true);
  });

  it("is case-insensitive on the email's domain part", () => {
    expect(emailMatchesDomain("person@Example.COM", "example.com")).toBe(true);
  });

  it("does NOT match a subdomain against the parent domain (deliberate — see domains.ts's own top comment)", () => {
    expect(emailMatchesDomain("person@mail.example.com", "example.com")).toBe(false);
  });

  it("does NOT match the parent domain against a subdomain entry", () => {
    expect(emailMatchesDomain("person@example.com", "mail.example.com")).toBe(false);
  });

  it("returns false for a malformed email with no @", () => {
    expect(emailMatchesDomain("not-an-email", "example.com")).toBe(false);
  });

  it("uses the LAST @ when resolving the domain part (defends against a crafted local-part containing @)", () => {
    expect(emailMatchesDomain('"weird@name"@example.com', "example.com")).toBe(true);
  });
});
