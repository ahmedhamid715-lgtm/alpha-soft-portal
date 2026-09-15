import { describe, it, expect } from "vitest";
import { normalizeBusinessName, normalizePhone, normalizeAddress, evaluateNapConsistency, type NapCanonical, type NapObserved } from "@/lib/local-seo/nap";

describe("normalizeBusinessName", () => {
  it("lowercases, trims, collapses whitespace, and strips punctuation", () => {
    expect(normalizeBusinessName("  Joe's   Pizza, Inc.  ")).toBe("joes pizza inc");
  });
  it("returns null for null/empty input", () => {
    expect(normalizeBusinessName(null)).toBeNull();
    expect(normalizeBusinessName("   ")).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("keeps digits only for a bare 10-digit number", () => {
    expect(normalizePhone("(212) 555-0100")).toBe("2125550100");
  });
  it("strips a leading NANP '1' country-code digit so +1 and bare forms compare equal", () => {
    expect(normalizePhone("+1 (212) 555-0100")).toBe("2125550100");
    expect(normalizePhone("+1 (212) 555-0100")).toBe(normalizePhone("212-555-0100"));
  });
  it("returns null for null/no-digit input", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("n/a")).toBeNull();
  });
});

describe("normalizeAddress", () => {
  it("combines line1/city/postalCode, lowercased and punctuation-stripped", () => {
    expect(normalizeAddress("123 Main St.", "Springfield", "62704")).toBe("123 main st springfield 62704");
  });
  it("returns null when all parts are missing", () => {
    expect(normalizeAddress(null, null, null)).toBeNull();
  });
  it("uses whatever parts are present", () => {
    expect(normalizeAddress(null, "Springfield", null)).toBe("springfield");
  });
});

describe("evaluateNapConsistency", () => {
  const canonical: NapCanonical = { businessName: "Joe's Pizza", addressLine1: "123 Main St", city: "Springfield", postalCode: "62704", phone: "+1 212-555-0100" };

  it("is CONSISTENT when all three fields match after normalization", () => {
    const observed: NapObserved = { observedBusinessName: "JOE'S PIZZA", observedAddressLine1: "123 Main St.", observedCity: "Springfield", observedPostalCode: "62704", observedPhone: "(212) 555-0100" };
    expect(evaluateNapConsistency(canonical, observed)).toBe("CONSISTENT");
  });

  it("is INCONSISTENT when any field genuinely mismatches", () => {
    const observed: NapObserved = { observedBusinessName: "Joe's Pizza", observedAddressLine1: "123 Main St", observedCity: "Springfield", observedPostalCode: "62704", observedPhone: "999-999-9999" };
    expect(evaluateNapConsistency(canonical, observed)).toBe("INCONSISTENT");
  });

  it("is PARTIAL when some fields match and others are unavailable, but none mismatch", () => {
    const observed: NapObserved = { observedBusinessName: "Joe's Pizza", observedAddressLine1: "123 Main St", observedCity: "Springfield", observedPostalCode: "62704", observedPhone: null };
    expect(evaluateNapConsistency(canonical, observed)).toBe("PARTIAL");
  });

  it("is NOT_MEASURABLE when nothing is comparable on either side", () => {
    const bareCanonical: NapCanonical = { businessName: null, addressLine1: null, city: null, postalCode: null, phone: null };
    const observed: NapObserved = { observedBusinessName: null, observedAddressLine1: null, observedCity: null, observedPostalCode: null, observedPhone: null };
    expect(evaluateNapConsistency(bareCanonical, observed)).toBe("NOT_MEASURABLE");
  });

  it("never calls a listing inconsistent merely because an optional field is absent", () => {
    const observed: NapObserved = { observedBusinessName: "Joe's Pizza", observedAddressLine1: null, observedCity: null, observedPostalCode: null, observedPhone: "212-555-0100" };
    const result = evaluateNapConsistency(canonical, observed);
    expect(result).not.toBe("INCONSISTENT");
    expect(result).toBe("PARTIAL");
  });
});
