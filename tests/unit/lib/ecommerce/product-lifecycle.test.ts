import { describe, it, expect } from "vitest";
import { canTransitionEcommerceProduct, ECOMMERCE_PRODUCT_READY_STATUSES, type EcommerceProductStatus } from "@/lib/ecommerce/product-lifecycle";

describe("canTransitionEcommerceProduct", () => {
  it("allows the forward happy path", () => {
    expect(canTransitionEcommerceProduct("PLANNED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionEcommerceProduct("IN_PROGRESS", "QA")).toBe(true);
    expect(canTransitionEcommerceProduct("QA", "READY_FOR_LAUNCH")).toBe(true);
    expect(canTransitionEcommerceProduct("READY_FOR_LAUNCH", "LIVE")).toBe(true);
  });

  it("allows pulling a QA'd or ready-for-launch product back for rework", () => {
    expect(canTransitionEcommerceProduct("QA", "IN_PROGRESS")).toBe(true);
    expect(canTransitionEcommerceProduct("READY_FOR_LAUNCH", "IN_PROGRESS")).toBe(true);
    expect(canTransitionEcommerceProduct("LIVE", "IN_PROGRESS")).toBe(true);
  });

  it("allows archiving from every non-terminal state, and restoring from ARCHIVED", () => {
    const states: EcommerceProductStatus[] = ["PLANNED", "IN_PROGRESS", "QA", "READY_FOR_LAUNCH", "LIVE"];
    for (const state of states) expect(canTransitionEcommerceProduct(state, "ARCHIVED")).toBe(true);
    expect(canTransitionEcommerceProduct("ARCHIVED", "IN_PROGRESS")).toBe(true);
  });

  it("rejects skipping states forward", () => {
    expect(canTransitionEcommerceProduct("PLANNED", "QA")).toBe(false);
    expect(canTransitionEcommerceProduct("PLANNED", "LIVE")).toBe(false);
    expect(canTransitionEcommerceProduct("IN_PROGRESS", "LIVE")).toBe(false);
  });

  it("rejects a no-op self-transition", () => {
    expect(canTransitionEcommerceProduct("PLANNED", "PLANNED")).toBe(false);
  });

  it("rejects ARCHIVED jumping straight to a non-IN_PROGRESS state", () => {
    expect(canTransitionEcommerceProduct("ARCHIVED", "LIVE")).toBe(false);
    expect(canTransitionEcommerceProduct("ARCHIVED", "READY_FOR_LAUNCH")).toBe(false);
  });
});

describe("ECOMMERCE_PRODUCT_READY_STATUSES", () => {
  it("is exactly READY_FOR_LAUNCH and LIVE", () => {
    expect(ECOMMERCE_PRODUCT_READY_STATUSES.sort()).toEqual(["LIVE", "READY_FOR_LAUNCH"].sort());
  });
});
