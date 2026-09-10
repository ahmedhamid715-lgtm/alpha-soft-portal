import { describe, expect, it } from "vitest";
import { canTransitionProject, canTransitionTask, PROJECT_TERMINAL_STATUSES, TASK_TERMINAL_STATUSES } from "@/lib/projects/lifecycle";

describe("canTransitionProject", () => {
  it("allows the ordinary forward path DRAFT -> PLANNED -> ACTIVE -> COMPLETED", () => {
    expect(canTransitionProject("DRAFT", "PLANNED")).toBe(true);
    expect(canTransitionProject("PLANNED", "ACTIVE")).toBe(true);
    expect(canTransitionProject("ACTIVE", "COMPLETED")).toBe(true);
  });

  it("allows ACTIVE <-> ON_HOLD in both directions", () => {
    expect(canTransitionProject("ACTIVE", "ON_HOLD")).toBe(true);
    expect(canTransitionProject("ON_HOLD", "ACTIVE")).toBe(true);
  });

  it("allows reopening a COMPLETED project back to ACTIVE", () => {
    expect(canTransitionProject("COMPLETED", "ACTIVE")).toBe(true);
  });

  it("allows archiving from both COMPLETED and CANCELLED", () => {
    expect(canTransitionProject("COMPLETED", "ARCHIVED")).toBe(true);
    expect(canTransitionProject("CANCELLED", "ARCHIVED")).toBe(true);
  });

  it("ARCHIVED has no outgoing transitions at all — final and non-reversible through this state machine", () => {
    for (const to of ["DRAFT", "PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED", "ARCHIVED"] as const) {
      expect(canTransitionProject("ARCHIVED", to)).toBe(false);
    }
  });

  it("rejects skipping straight from DRAFT to ACTIVE", () => {
    expect(canTransitionProject("DRAFT", "ACTIVE")).toBe(false);
  });

  it("rejects a no-op self-transition", () => {
    expect(canTransitionProject("ACTIVE", "ACTIVE")).toBe(false);
  });

  it("PROJECT_TERMINAL_STATUSES matches the states with genuinely restricted outgoing transitions", () => {
    expect(PROJECT_TERMINAL_STATUSES).toEqual(["COMPLETED", "CANCELLED", "ARCHIVED"]);
  });
});

describe("canTransitionTask", () => {
  it("allows the ordinary forward path TODO -> IN_PROGRESS -> DONE", () => {
    expect(canTransitionTask("TODO", "IN_PROGRESS")).toBe(true);
    expect(canTransitionTask("IN_PROGRESS", "DONE")).toBe(true);
  });

  it("allows marking DONE directly from BLOCKED (the blocker may have been resolved outside the system)", () => {
    expect(canTransitionTask("BLOCKED", "DONE")).toBe(true);
  });

  it("allows reopening a DONE task back to TODO/IN_PROGRESS", () => {
    expect(canTransitionTask("DONE", "TODO")).toBe(true);
    expect(canTransitionTask("DONE", "IN_PROGRESS")).toBe(true);
  });

  it("CANCELLED has no outgoing transitions", () => {
    for (const to of ["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"] as const) {
      expect(canTransitionTask("CANCELLED", to)).toBe(false);
    }
  });

  it("TASK_TERMINAL_STATUSES is DONE and CANCELLED", () => {
    expect(TASK_TERMINAL_STATUSES).toEqual(["DONE", "CANCELLED"]);
  });
});
