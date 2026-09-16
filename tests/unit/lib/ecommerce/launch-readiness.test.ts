import { describe, it, expect } from "vitest";
import { evaluateEcommerceReadiness, type EcommerceReadinessInput } from "@/lib/ecommerce/launch-readiness";

function baseInput(overrides: Partial<EcommerceReadinessInput> = {}): EcommerceReadinessInput {
  return {
    storeExists: true,
    checkoutConfigured: true,
    paymentConfigured: true,
    requiredProductCount: 0,
    completedRequiredProductCount: 0,
    requiredQaCount: 0,
    passedRequiredQaCount: 0,
    linkedWebsiteReadiness: null,
    ...overrides,
  };
}

describe("evaluateEcommerceReadiness", () => {
  it("is NOT_MEASURABLE when no store exists yet — never fabricated", () => {
    const result = evaluateEcommerceReadiness(baseInput({ storeExists: false }));
    expect(result.status).toBe("NOT_MEASURABLE");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("is READY once a store exists with every input satisfied — never NOT_MEASURABLE once a store exists", () => {
    expect(evaluateEcommerceReadiness(baseInput()).status).toBe("READY");
  });

  it("blocks unconditionally when checkout is not configured", () => {
    const result = evaluateEcommerceReadiness(baseInput({ checkoutConfigured: false }));
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons.some((r) => r.toLowerCase().includes("checkout"))).toBe(true);
  });

  it("blocks unconditionally when payment is not configured", () => {
    const result = evaluateEcommerceReadiness(baseInput({ paymentConfigured: false }));
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons.some((r) => r.toLowerCase().includes("payment"))).toBe(true);
  });

  it("does not block on required products when the denominator is zero — a zero denominator is not fabricated 100%, but also not a failure", () => {
    expect(evaluateEcommerceReadiness(baseInput({ requiredProductCount: 0, completedRequiredProductCount: 0 })).status).toBe("READY");
  });

  it("blocks when required products are incomplete", () => {
    const result = evaluateEcommerceReadiness(baseInput({ requiredProductCount: 5, completedRequiredProductCount: 2 }));
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons.some((r) => r.includes("3 of 5"))).toBe(true);
  });

  it("does not block on required QA when the denominator is zero", () => {
    expect(evaluateEcommerceReadiness(baseInput({ requiredQaCount: 0 })).status).toBe("READY");
  });

  it("blocks when required QA has not all passed", () => {
    const result = evaluateEcommerceReadiness(baseInput({ requiredQaCount: 3, passedRequiredQaCount: 1 }));
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons.some((r) => r.includes("2 of 3"))).toBe(true);
  });

  it("does not block when there is no linked website (null readiness)", () => {
    expect(evaluateEcommerceReadiness(baseInput({ linkedWebsiteReadiness: null })).status).toBe("READY");
  });

  it("blocks when the linked website is NOT_READY, and passes it through verbatim rather than re-deriving it", () => {
    const result = evaluateEcommerceReadiness(baseInput({ linkedWebsiteReadiness: "NOT_READY" }));
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons.some((r) => r.toLowerCase().includes("website"))).toBe(true);
  });

  it("does not block when the linked website is READY", () => {
    expect(evaluateEcommerceReadiness(baseInput({ linkedWebsiteReadiness: "READY" })).status).toBe("READY");
  });

  it("reports every blocking reason at once, never truncated to the first failure", () => {
    const result = evaluateEcommerceReadiness(
      baseInput({ checkoutConfigured: false, paymentConfigured: false, requiredProductCount: 2, completedRequiredProductCount: 0, requiredQaCount: 1, passedRequiredQaCount: 0, linkedWebsiteReadiness: "NOT_READY" }),
    );
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons.length).toBe(5);
  });
});
