import { describe, expect, it } from "vitest";
import { taskItemKeyToString, parseTaskItemKey } from "@/lib/tasks/types";

describe("task item key", () => {
  it("round-trips every valid source type", () => {
    for (const sourceType of ["PROJECT_TASK", "CRM_TASK", "ONBOARDING_CHECKLIST", "ONBOARDING_REQUIREMENT", "STANDALONE_TASK"] as const) {
      const key = taskItemKeyToString({ sourceType, sourceId: "0199a1b2-0000-7000-8000-000000000001" });
      expect(parseTaskItemKey(key)).toEqual({ sourceType, sourceId: "0199a1b2-0000-7000-8000-000000000001" });
    }
  });

  it("returns null (never throws) for a forged/unknown sourceType", () => {
    expect(parseTaskItemKey("NOT_A_REAL_SOURCE:abc")).toBeNull();
  });

  it("returns null for a malformed key with no separator", () => {
    expect(parseTaskItemKey("malformed")).toBeNull();
  });

  it("returns null for an empty sourceId", () => {
    expect(parseTaskItemKey("PROJECT_TASK:")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseTaskItemKey("")).toBeNull();
  });
});
