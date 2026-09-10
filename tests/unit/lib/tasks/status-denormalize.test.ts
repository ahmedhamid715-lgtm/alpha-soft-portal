import { describe, expect, it } from "vitest";
import { denormalizeStatusesForSource, allRawStatusesForSource } from "@/lib/tasks/status-denormalize";
import { normalizeTaskStatus } from "@/lib/tasks/status";
import type { TaskSourceType } from "@/lib/tasks/types";

const ALL_SOURCES: TaskSourceType[] = ["PROJECT_TASK", "CRM_TASK", "ONBOARDING_CHECKLIST", "ONBOARDING_REQUIREMENT", "STANDALONE_TASK"];

describe("denormalizeStatusesForSource", () => {
  it("is the exact inverse of normalizeTaskStatus for every raw status of every source — round-trips cleanly", () => {
    for (const sourceType of ALL_SOURCES) {
      for (const raw of allRawStatusesForSource(sourceType)) {
        const normalized = normalizeTaskStatus(sourceType, raw);
        expect(denormalizeStatusesForSource(sourceType, [normalized])).toContain(raw);
      }
    }
  });

  it("returns an empty array — never every value, never a throw — when a source has no raw status for a requested normalized value", () => {
    // CrmTask has no BLOCKED/IN_PROGRESS concept.
    expect(denormalizeStatusesForSource("CRM_TASK", ["BLOCKED"])).toEqual([]);
    expect(denormalizeStatusesForSource("CRM_TASK", ["IN_PROGRESS"])).toEqual([]);
    // Onboarding items have no CANCELLED or BLOCKED concept.
    expect(denormalizeStatusesForSource("ONBOARDING_CHECKLIST", ["CANCELLED"])).toEqual([]);
    expect(denormalizeStatusesForSource("ONBOARDING_REQUIREMENT", ["BLOCKED"])).toEqual([]);
  });

  it("flattens multiple normalized statuses into their combined raw set", () => {
    expect(denormalizeStatusesForSource("PROJECT_TASK", ["COMPLETED", "CANCELLED"]).sort()).toEqual(["CANCELLED", "DONE"]);
  });

  it("an empty input list denormalizes to an empty output list", () => {
    for (const sourceType of ALL_SOURCES) expect(denormalizeStatusesForSource(sourceType, [])).toEqual([]);
  });
});

describe("allRawStatusesForSource", () => {
  it("returns every raw status normalizeTaskStatus() itself accepts, for every source", () => {
    for (const sourceType of ALL_SOURCES) {
      for (const raw of allRawStatusesForSource(sourceType)) {
        expect(() => normalizeTaskStatus(sourceType, raw)).not.toThrow();
      }
    }
  });

  it("CrmTask has exactly 3 raw statuses, onboarding items exactly 3, standalone tasks exactly 4 — no source silently gained/lost a value", () => {
    expect(allRawStatusesForSource("CRM_TASK")).toHaveLength(3);
    expect(allRawStatusesForSource("ONBOARDING_CHECKLIST")).toHaveLength(3);
    expect(allRawStatusesForSource("ONBOARDING_REQUIREMENT")).toHaveLength(3);
    expect(allRawStatusesForSource("STANDALONE_TASK")).toHaveLength(4);
    expect(allRawStatusesForSource("PROJECT_TASK")).toHaveLength(5);
  });
});
