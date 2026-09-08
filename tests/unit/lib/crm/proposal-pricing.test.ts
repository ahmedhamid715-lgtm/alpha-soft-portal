import { describe, expect, it } from "vitest";
import { applyTax, priceLineItem, priceProposal, resolveDiscountAmount, validateDiscount } from "@/lib/crm/proposal-pricing";
import { ValidationError } from "@/lib/errors/app-error";

describe("proposal-pricing", () => {
  describe("validateDiscount", () => {
    it("accepts NONE with a null value", () => {
      expect(() => validateDiscount({ discountType: "NONE", discountValue: null }, "x")).not.toThrow();
    });

    it("rejects NONE with a non-null value", () => {
      expect(() => validateDiscount({ discountType: "NONE", discountValue: 100 }, "x")).toThrow(ValidationError);
    });

    it("rejects FIXED with a null value", () => {
      expect(() => validateDiscount({ discountType: "FIXED", discountValue: null }, "x")).toThrow(ValidationError);
    });

    it("rejects a negative FIXED value", () => {
      expect(() => validateDiscount({ discountType: "FIXED", discountValue: -1 }, "x")).toThrow(ValidationError);
    });

    it("rejects a non-integer discount value", () => {
      expect(() => validateDiscount({ discountType: "FIXED", discountValue: 1.5 }, "x")).toThrow(ValidationError);
    });

    it("rejects PERCENT over 100", () => {
      expect(() => validateDiscount({ discountType: "PERCENT", discountValue: 101 }, "x")).toThrow(ValidationError);
    });

    it("accepts PERCENT at exactly 100", () => {
      expect(() => validateDiscount({ discountType: "PERCENT", discountValue: 100 }, "x")).not.toThrow();
    });
  });

  describe("resolveDiscountAmount", () => {
    it("returns 0 for NONE", () => {
      expect(resolveDiscountAmount(10_000, { discountType: "NONE", discountValue: null })).toBe(0);
    });

    it("resolves FIXED directly, in minor units", () => {
      expect(resolveDiscountAmount(10_000, { discountType: "FIXED", discountValue: 1_500 })).toBe(1_500);
    });

    it("clamps a FIXED discount larger than the base — never a negative total", () => {
      expect(resolveDiscountAmount(1_000, { discountType: "FIXED", discountValue: 5_000 })).toBe(1_000);
    });

    it("resolves PERCENT as a rounded fraction of the base", () => {
      expect(resolveDiscountAmount(10_000, { discountType: "PERCENT", discountValue: 25 })).toBe(2_500);
    });

    it("rounds PERCENT to the nearest minor unit", () => {
      // 333 * 0.10 = 33.3 -> rounds to 33
      expect(resolveDiscountAmount(333, { discountType: "PERCENT", discountValue: 10 })).toBe(33);
    });
  });

  describe("priceLineItem", () => {
    it("computes quantity x unitAmount as the line total with no discount", () => {
      const priced = priceLineItem({ quantity: 3, unitAmountMinorUnits: 1_000, discountType: "NONE", discountValue: null });
      expect(priced.lineTotalMinorUnits).toBe(3_000);
    });

    it("applies a per-line FIXED discount", () => {
      const priced = priceLineItem({ quantity: 2, unitAmountMinorUnits: 5_000, discountType: "FIXED", discountValue: 1_000 });
      expect(priced.lineTotalMinorUnits).toBe(9_000);
    });

    it("applies a per-line PERCENT discount", () => {
      const priced = priceLineItem({ quantity: 1, unitAmountMinorUnits: 10_000, discountType: "PERCENT", discountValue: 20 });
      expect(priced.lineTotalMinorUnits).toBe(8_000);
    });

    it("rejects a zero quantity", () => {
      expect(() => priceLineItem({ quantity: 0, unitAmountMinorUnits: 1_000, discountType: "NONE", discountValue: null })).toThrow(ValidationError);
    });

    it("rejects a negative unit amount", () => {
      expect(() => priceLineItem({ quantity: 1, unitAmountMinorUnits: -1, discountType: "NONE", discountValue: null })).toThrow(ValidationError);
    });

    it("rejects a non-integer quantity", () => {
      expect(() => priceLineItem({ quantity: 1.5, unitAmountMinorUnits: 1_000, discountType: "NONE", discountValue: null })).toThrow(ValidationError);
    });
  });

  describe("priceProposal", () => {
    it("sums line totals into a subtotal, with no proposal-level discount", () => {
      const { totals } = priceProposal(
        [
          { quantity: 1, unitAmountMinorUnits: 10_000, discountType: "NONE", discountValue: null },
          { quantity: 2, unitAmountMinorUnits: 5_000, discountType: "NONE", discountValue: null },
        ],
        { discountType: "NONE", discountValue: null },
      );
      expect(totals.subtotalMinorUnits).toBe(20_000);
      expect(totals.discountedSubtotalMinorUnits).toBe(20_000);
      expect(totals.totalMinorUnits).toBe(20_000);
    });

    it("applies a proposal-level PERCENT discount on top of already-discounted line items", () => {
      const { totals } = priceProposal(
        [{ quantity: 1, unitAmountMinorUnits: 10_000, discountType: "FIXED", discountValue: 2_000 }],
        { discountType: "PERCENT", discountValue: 10 },
      );
      // Line: 10,000 - 2,000 = 8,000 subtotal. Proposal discount: 10% of 8,000 = 800.
      expect(totals.subtotalMinorUnits).toBe(8_000);
      expect(totals.discountedSubtotalMinorUnits).toBe(7_200);
    });

    it("never produces a negative total even with a full-subtotal discount", () => {
      const { totals } = priceProposal([{ quantity: 1, unitAmountMinorUnits: 100, discountType: "NONE", discountValue: null }], { discountType: "FIXED", discountValue: 999_999 });
      expect(totals.discountedSubtotalMinorUnits).toBe(0);
    });

    it("rejects an empty-list proposal discount validation independent of line items", () => {
      expect(() => priceProposal([{ quantity: 1, unitAmountMinorUnits: 100, discountType: "NONE", discountValue: null }], { discountType: "PERCENT", discountValue: 150 })).toThrow(ValidationError);
    });
  });

  describe("applyTax", () => {
    it("returns the discounted subtotal unchanged when tax is null (not fabricated)", () => {
      expect(applyTax(10_000, null)).toBe(10_000);
    });

    it("adds an explicitly supplied tax amount", () => {
      expect(applyTax(10_000, 800)).toBe(10_800);
    });

    it("rejects a negative tax amount", () => {
      expect(() => applyTax(10_000, -1)).toThrow(ValidationError);
    });

    it("rejects a non-integer tax amount", () => {
      expect(() => applyTax(10_000, 1.5)).toThrow(ValidationError);
    });
  });
});
