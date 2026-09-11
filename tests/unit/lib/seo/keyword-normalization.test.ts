import { describe, it, expect } from "vitest";
import { normalizeKeywordPhrase } from "@/lib/seo/keyword-normalization";

describe("normalizeKeywordPhrase", () => {
  it("trims, collapses internal whitespace, and lowercases", () => {
    expect(normalizeKeywordPhrase("  Best   Pizza   NYC  ")).toBe("best pizza nyc");
  });

  it("two differently-cased/spaced inputs normalize to the same value", () => {
    expect(normalizeKeywordPhrase("Best Pizza NYC")).toBe(normalizeKeywordPhrase("best   pizza nyc"));
  });

  it("collapses tabs and newlines too", () => {
    expect(normalizeKeywordPhrase("best\tpizza\nnyc")).toBe("best pizza nyc");
  });
});
