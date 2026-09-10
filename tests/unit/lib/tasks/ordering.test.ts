import { describe, expect, it } from "vitest";
import { compareTaskItems } from "@/lib/tasks/ordering";
import type { TaskItem } from "@/lib/tasks/types";

function item(overrides: Partial<TaskItem>): TaskItem {
  const sourceType = overrides.sourceType ?? "STANDALONE_TASK";
  const sourceId = overrides.sourceId ?? "a";
  return {
    key: `${sourceType}:${sourceId}`,
    sourceType,
    sourceId,
    title: "t",
    descriptionPreview: null,
    status: "OPEN",
    sourceStatus: "OPEN",
    priority: null,
    assigneeUserId: null,
    assigneeName: null,
    dueAt: null,
    isOverdue: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    completedAt: null,
    context: { companyName: null, projectId: null, projectTitle: null, onboardingId: null },
    href: "/admin/tasks",
    capabilities: { canComplete: false, canReopen: false, canAssign: false, canChangeDueDate: false },
    ...overrides,
  };
}

describe("compareTaskItems", () => {
  it("orders by due date ascending first", () => {
    const earlier = item({ sourceId: "a", dueAt: new Date("2026-06-01T00:00:00Z") });
    const later = item({ sourceId: "b", dueAt: new Date("2026-06-02T00:00:00Z") });
    expect(compareTaskItems(earlier, later)).toBeLessThan(0);
    expect(compareTaskItems(later, earlier)).toBeGreaterThan(0);
  });

  it("sorts a null due date LAST, after every real due date", () => {
    const withDue = item({ sourceId: "a", dueAt: new Date("2026-06-01T00:00:00Z") });
    const noDue = item({ sourceId: "b", dueAt: null });
    expect(compareTaskItems(withDue, noDue)).toBeLessThan(0);
    expect(compareTaskItems(noDue, withDue)).toBeGreaterThan(0);
  });

  it("falls back to createdAt ascending when due dates tie", () => {
    const older = item({ sourceId: "a", dueAt: null, createdAt: new Date("2026-01-01T00:00:00Z") });
    const newer = item({ sourceId: "b", dueAt: null, createdAt: new Date("2026-02-01T00:00:00Z") });
    expect(compareTaskItems(older, newer)).toBeLessThan(0);
  });

  it("falls back to sourceType, then sourceId as the final deterministic tie-break", () => {
    const sameDueAndCreated = { dueAt: null, createdAt: new Date("2026-01-01T00:00:00Z") };
    const a = item({ sourceType: "CRM_TASK", sourceId: "z", ...sameDueAndCreated });
    const b = item({ sourceType: "PROJECT_TASK", sourceId: "a", ...sameDueAndCreated });
    expect(compareTaskItems(a, b)).toBeLessThan(0); // "CRM_TASK" < "PROJECT_TASK"

    const c = item({ sourceType: "CRM_TASK", sourceId: "a", ...sameDueAndCreated });
    const d = item({ sourceType: "CRM_TASK", sourceId: "b", ...sameDueAndCreated });
    expect(compareTaskItems(c, d)).toBeLessThan(0);
  });

  it("is a total order — sorting a shuffled array is deterministic and stable across repeated sorts", () => {
    const items = [
      item({ sourceType: "PROJECT_TASK", sourceId: "1", dueAt: new Date("2026-06-03T00:00:00Z") }),
      item({ sourceType: "CRM_TASK", sourceId: "2", dueAt: null, createdAt: new Date("2026-01-01T00:00:00Z") }),
      item({ sourceType: "ONBOARDING_CHECKLIST", sourceId: "3", dueAt: new Date("2026-06-01T00:00:00Z") }),
      item({ sourceType: "STANDALONE_TASK", sourceId: "4", dueAt: new Date("2026-06-01T00:00:00Z") }),
    ];
    const sortedOnce = [...items].sort(compareTaskItems).map((i) => i.key);
    const sortedTwice = [...items].sort(compareTaskItems).sort(compareTaskItems).map((i) => i.key);
    expect(sortedOnce).toEqual(sortedTwice);
    // Both due on 2026-06-01 — tie-broken by sourceType: "ONBOARDING_CHECKLIST" < "STANDALONE_TASK".
    expect(sortedOnce.slice(0, 2)).toEqual(["ONBOARDING_CHECKLIST:3", "STANDALONE_TASK:4"]);
  });
});
