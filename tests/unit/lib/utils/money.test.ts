import { describe, expect, it } from "vitest";
import {
  addMoney,
  CurrencyMismatchError,
  formatMoney,
  fromMinorUnits,
  getCurrencyExponent,
  toMinorUnits,
} from "@/lib/utils/money";

describe("money", () => {
  it("uses 2 decimal places for USD", () => {
    expect(getCurrencyExponent("USD")).toBe(2);
  });

  it("uses 0 decimal places for zero-decimal currencies", () => {
    expect(getCurrencyExponent("JPY")).toBe(0);
  });

  it("uses 3 decimal places for three-decimal currencies", () => {
    expect(getCurrencyExponent("KWD")).toBe(3);
  });

  it("converts a major-unit amount to minor units", () => {
    expect(toMinorUnits(19.99, "USD")).toBe(1999);
  });

  it("round-trips through minor units without float drift", () => {
    const minor = toMinorUnits(19.99, "USD");
    expect(fromMinorUnits(minor, "USD")).toBeCloseTo(19.99, 10);
  });

  it("treats zero-decimal currencies as whole minor units", () => {
    expect(toMinorUnits(500, "JPY")).toBe(500);
  });

  it("formats minor units as a localized currency string", () => {
    expect(formatMoney(1999, "USD")).toBe("$19.99");
  });

  it("adds two amounts in the same currency", () => {
    const result = addMoney({ minorUnits: 1000, currency: "USD" }, { minorUnits: 250, currency: "USD" });
    expect(result).toEqual({ minorUnits: 1250, currency: "USD" });
  });

  it("throws when adding mismatched currencies", () => {
    expect(() => addMoney({ minorUnits: 1000, currency: "USD" }, { minorUnits: 250, currency: "EUR" })).toThrow(
      CurrencyMismatchError,
    );
  });

  it("avoids the classic 0.1 + 0.2 float trap by staying in integers", () => {
    const a = toMinorUnits(0.1, "USD");
    const b = toMinorUnits(0.2, "USD");
    expect(addMoney({ minorUnits: a, currency: "USD" }, { minorUnits: b, currency: "USD" })).toEqual({
      minorUnits: 30,
      currency: "USD",
    });
  });
});
