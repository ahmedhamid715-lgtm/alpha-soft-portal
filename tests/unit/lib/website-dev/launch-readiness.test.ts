import { describe, it, expect } from "vitest";
import { evaluateLaunchReadiness, type LaunchReadinessInput } from "@/lib/website-dev/launch-readiness";

describe("evaluateLaunchReadiness", () => {
  function input(overrides: Partial<LaunchReadinessInput>): LaunchReadinessInput {
    return { siteExists: true, hasPrimaryDomain: true, hasProductionEnvironment: true, requiredPageCount: 0, completedRequiredPageCount: 0, requiredQaCount: 0, passedRequiredQaCount: 0, ...overrides };
  }

  it("is NOT_MEASURABLE when no site exists yet — never fabricated", () => {
    const result = evaluateLaunchReadiness(input({ siteExists: false }));
    expect(result.status).toBe("NOT_MEASURABLE");
  });

  it("is READY when domain+production are recorded and zero pages/QA are required — never fabricates a requirement that doesn't exist", () => {
    expect(evaluateLaunchReadiness(input({})).status).toBe("READY");
  });

  it("is NOT_READY when no primary domain is recorded", () => {
    const result = evaluateLaunchReadiness(input({ hasPrimaryDomain: false }));
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons.some((r) => r.includes("primary domain"))).toBe(true);
  });

  it("is NOT_READY when no production environment is recorded", () => {
    const result = evaluateLaunchReadiness(input({ hasProductionEnvironment: false }));
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons.some((r) => r.includes("production environment"))).toBe(true);
  });

  it("is NOT_READY when required pages are incomplete, but not when they're all complete", () => {
    expect(evaluateLaunchReadiness(input({ requiredPageCount: 3, completedRequiredPageCount: 2 })).status).toBe("NOT_READY");
    expect(evaluateLaunchReadiness(input({ requiredPageCount: 3, completedRequiredPageCount: 3 })).status).toBe("READY");
  });

  it("is NOT_READY when required QA checks haven't all passed, but not when they have", () => {
    expect(evaluateLaunchReadiness(input({ requiredQaCount: 2, passedRequiredQaCount: 1 })).status).toBe("NOT_READY");
    expect(evaluateLaunchReadiness(input({ requiredQaCount: 2, passedRequiredQaCount: 2 })).status).toBe("READY");
  });

  it("never blocks on a zero-denominator component — zero required pages/QA never counts as incomplete", () => {
    const result = evaluateLaunchReadiness(input({ requiredPageCount: 0, requiredQaCount: 0 }));
    expect(result.status).toBe("READY");
    expect(result.reasons).toEqual([]);
  });

  it("reports every blocking reason at once, not just the first", () => {
    const result = evaluateLaunchReadiness(input({ hasPrimaryDomain: false, hasProductionEnvironment: false, requiredPageCount: 1, completedRequiredPageCount: 0 }));
    expect(result.reasons.length).toBe(3);
  });
});
