import { describe, expect, it } from "vitest";
import { isOverdue, classifyDueWindow } from "@/lib/tasks/due-window";

const NOW = new Date("2026-06-15T15:00:00Z");

describe("isOverdue", () => {
  it("is false when there is no due date", () => {
    expect(isOverdue(null, "OPEN", NOW)).toBe(false);
  });

  it("is true for a due date on a prior UTC calendar day, open status", () => {
    expect(isOverdue(new Date("2026-06-14T23:59:00Z"), "OPEN", NOW)).toBe(true);
    expect(isOverdue(new Date("2026-06-01T00:00:00Z"), "IN_PROGRESS", NOW)).toBe(true);
  });

  it("is false for a due date later today, even though the specific due TIME has already passed — day granularity, not instant", () => {
    expect(isOverdue(new Date("2026-06-15T09:00:00Z"), "OPEN", NOW)).toBe(false);
  });

  it("is false for a due date in the future", () => {
    expect(isOverdue(new Date("2026-06-16T00:00:00Z"), "OPEN", NOW)).toBe(false);
  });

  it("is NEVER true for a COMPLETED or CANCELLED task, regardless of how far past the due date is", () => {
    expect(isOverdue(new Date("2020-01-01T00:00:00Z"), "COMPLETED", NOW)).toBe(false);
    expect(isOverdue(new Date("2020-01-01T00:00:00Z"), "CANCELLED", NOW)).toBe(false);
  });
});

describe("classifyDueWindow", () => {
  it("is null for terminal statuses regardless of due date", () => {
    expect(classifyDueWindow(new Date("2020-01-01T00:00:00Z"), "COMPLETED", NOW)).toBeNull();
    expect(classifyDueWindow(null, "CANCELLED", NOW)).toBeNull();
  });

  it("is NO_DUE_DATE for open work with no due date", () => {
    expect(classifyDueWindow(null, "OPEN", NOW)).toBe("NO_DUE_DATE");
  });

  it("is OVERDUE for a due date on a prior UTC calendar day", () => {
    expect(classifyDueWindow(new Date("2026-06-14T23:59:00Z"), "OPEN", NOW)).toBe("OVERDUE");
  });

  it("is DUE_TODAY for any due time on the same UTC calendar day, even one already past", () => {
    expect(classifyDueWindow(new Date("2026-06-15T00:00:00Z"), "OPEN", NOW)).toBe("DUE_TODAY");
    expect(classifyDueWindow(new Date("2026-06-15T23:59:59Z"), "BLOCKED", NOW)).toBe("DUE_TODAY");
  });

  it("is UPCOMING for a future UTC calendar day", () => {
    expect(classifyDueWindow(new Date("2026-06-16T00:00:00Z"), "OPEN", NOW)).toBe("UPCOMING");
  });

  it("never double-counts: OVERDUE and DUE_TODAY are mutually exclusive by construction, matching isOverdue's own day-granularity choice", () => {
    const dueToday = new Date("2026-06-15T09:00:00Z");
    expect(isOverdue(dueToday, "OPEN", NOW)).toBe(false);
    expect(classifyDueWindow(dueToday, "OPEN", NOW)).toBe("DUE_TODAY");
  });
});
