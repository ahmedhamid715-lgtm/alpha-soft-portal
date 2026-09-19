import { describe, expect, it } from "vitest";
import { evaluateGhlReadiness, type GhlReadinessInput } from "@/lib/ghl/readiness";

const base: GhlReadinessInput = {
  workspaceExists: true,
  requiredAssetCount: 0,
  completedRequiredAssetCount: 0,
  qaFailedRequiredAssetCount: 0,
  requiredIntegrationCount: 0,
  confirmedRequiredIntegrationCount: 0,
  requiredQaCount: 0,
  passedRequiredQaCount: 0,
};

describe("evaluateGhlReadiness", () => {
  it("is NOT_MEASURABLE when no workspace exists, regardless of other inputs", () => {
    const result = evaluateGhlReadiness({ ...base, workspaceExists: false, requiredAssetCount: 5, completedRequiredAssetCount: 5 });
    expect(result.status).toBe("NOT_MEASURABLE");
  });

  it("is READY with zero required assets/integrations/QA (nothing to block on)", () => {
    const result = evaluateGhlReadiness(base);
    expect(result.status).toBe("READY");
    expect(result.reasons).toEqual([]);
  });

  it("never fabricates 100% completion from a zero-denominator required-asset count", () => {
    const result = evaluateGhlReadiness({ ...base, requiredAssetCount: 0, completedRequiredAssetCount: 0 });
    expect(result.status).toBe("READY");
  });

  it("blocks when required assets are not all complete", () => {
    const result = evaluateGhlReadiness({ ...base, requiredAssetCount: 3, completedRequiredAssetCount: 1 });
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons).toEqual(["2 of 3 required asset(s) are not yet ready."]);
  });

  it("blocks unconditionally when any required asset is QA_FAILED, even if the count also satisfies completion", () => {
    const result = evaluateGhlReadiness({ ...base, requiredAssetCount: 3, completedRequiredAssetCount: 3, qaFailedRequiredAssetCount: 1 });
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons).toContain("1 required asset(s) are failing QA.");
  });

  it("blocks when required integrations are not all confirmed", () => {
    const result = evaluateGhlReadiness({ ...base, requiredIntegrationCount: 2, confirmedRequiredIntegrationCount: 0 });
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons).toEqual(["2 of 2 required integration(s) are not yet confirmed."]);
  });

  it("blocks when required QA checks have not all passed", () => {
    const result = evaluateGhlReadiness({ ...base, requiredQaCount: 4, passedRequiredQaCount: 2 });
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons).toEqual(["2 of 4 required QA check(s) have not passed."]);
  });

  it("reports every blocking reason at once, never truncated to the first failure", () => {
    const result = evaluateGhlReadiness({
      workspaceExists: true,
      requiredAssetCount: 2,
      completedRequiredAssetCount: 0,
      qaFailedRequiredAssetCount: 1,
      requiredIntegrationCount: 1,
      confirmedRequiredIntegrationCount: 0,
      requiredQaCount: 1,
      passedRequiredQaCount: 0,
    });
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons).toHaveLength(4);
  });

  it("is READY once every required component is satisfied", () => {
    const result = evaluateGhlReadiness({
      workspaceExists: true,
      requiredAssetCount: 5,
      completedRequiredAssetCount: 5,
      qaFailedRequiredAssetCount: 0,
      requiredIntegrationCount: 2,
      confirmedRequiredIntegrationCount: 2,
      requiredQaCount: 3,
      passedRequiredQaCount: 3,
    });
    expect(result.status).toBe("READY");
    expect(result.reasons).toEqual([]);
  });

  it("missing/zero QA data is never counted as bad (no linked project)", () => {
    const result = evaluateGhlReadiness({ ...base, requiredAssetCount: 1, completedRequiredAssetCount: 1, requiredQaCount: 0, passedRequiredQaCount: 0 });
    expect(result.status).toBe("READY");
  });
});
