import { describe, expect, it } from "vitest";
import { normalizeTaskStatus, isTerminalStatus } from "@/lib/tasks/status";

describe("normalizeTaskStatus", () => {
  it("normalizes every ProjectTask status", () => {
    expect(normalizeTaskStatus("PROJECT_TASK", "TODO")).toBe("OPEN");
    expect(normalizeTaskStatus("PROJECT_TASK", "IN_PROGRESS")).toBe("IN_PROGRESS");
    expect(normalizeTaskStatus("PROJECT_TASK", "BLOCKED")).toBe("BLOCKED");
    expect(normalizeTaskStatus("PROJECT_TASK", "DONE")).toBe("COMPLETED");
    expect(normalizeTaskStatus("PROJECT_TASK", "CANCELLED")).toBe("CANCELLED");
  });

  it("normalizes every CrmTask status — no BLOCKED, no IN_PROGRESS concept", () => {
    expect(normalizeTaskStatus("CRM_TASK", "OPEN")).toBe("OPEN");
    expect(normalizeTaskStatus("CRM_TASK", "COMPLETED")).toBe("COMPLETED");
    expect(normalizeTaskStatus("CRM_TASK", "CANCELLED")).toBe("CANCELLED");
  });

  it("normalizes onboarding checklist/requirement statuses identically — no CANCELLED concept in either source", () => {
    for (const sourceType of ["ONBOARDING_CHECKLIST", "ONBOARDING_REQUIREMENT"] as const) {
      expect(normalizeTaskStatus(sourceType, "PENDING")).toBe("OPEN");
      expect(normalizeTaskStatus(sourceType, "IN_PROGRESS")).toBe("IN_PROGRESS");
      expect(normalizeTaskStatus(sourceType, "COMPLETE")).toBe("COMPLETED");
    }
  });

  it("normalizes every standalone InternalTask status", () => {
    expect(normalizeTaskStatus("STANDALONE_TASK", "OPEN")).toBe("OPEN");
    expect(normalizeTaskStatus("STANDALONE_TASK", "IN_PROGRESS")).toBe("IN_PROGRESS");
    expect(normalizeTaskStatus("STANDALONE_TASK", "COMPLETED")).toBe("COMPLETED");
    expect(normalizeTaskStatus("STANDALONE_TASK", "CANCELLED")).toBe("CANCELLED");
  });

  it("throws on an unknown raw status for a source, rather than silently guessing", () => {
    expect(() => normalizeTaskStatus("CRM_TASK", "BLOCKED")).toThrow(/Unknown/);
    expect(() => normalizeTaskStatus("ONBOARDING_REQUIREMENT", "CANCELLED")).toThrow(/Unknown/);
  });
});

describe("isTerminalStatus", () => {
  it("is true only for COMPLETED and CANCELLED", () => {
    expect(isTerminalStatus("COMPLETED")).toBe(true);
    expect(isTerminalStatus("CANCELLED")).toBe(true);
    expect(isTerminalStatus("OPEN")).toBe(false);
    expect(isTerminalStatus("IN_PROGRESS")).toBe(false);
    expect(isTerminalStatus("BLOCKED")).toBe(false);
  });
});
