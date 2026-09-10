import { describe, expect, it } from "vitest";
import { calculateMilestoneProgress, calculateProjectProgress, evaluateProjectCompletionCriteria, type ProgressTaskInput } from "@/lib/projects/progress";

function task(id: string, status: ProgressTaskInput["status"], parentTaskId: string | null = null): ProgressTaskInput {
  return { id, status, parentTaskId };
}

describe("calculateProjectProgress / calculateMilestoneProgress", () => {
  it("is NOT_MEASURABLE for zero tasks — never a fabricated 0%", () => {
    expect(calculateProjectProgress([])).toEqual({ kind: "NOT_MEASURABLE" });
    expect(calculateMilestoneProgress([])).toEqual({ kind: "NOT_MEASURABLE" });
  });

  it("is NOT_MEASURABLE when every task is cancelled — never a fabricated 0% or 100%", () => {
    const tasks = [task("1", "CANCELLED"), task("2", "CANCELLED")];
    expect(calculateProjectProgress(tasks)).toEqual({ kind: "NOT_MEASURABLE" });
  });

  it("excludes cancelled tasks from both numerator and denominator", () => {
    const tasks = [task("1", "DONE"), task("2", "CANCELLED"), task("3", "TODO")];
    // Eligible: task 1 (done) + task 3 (todo) = 2 eligible, 1 done = 50%.
    expect(calculateProjectProgress(tasks)).toEqual({ kind: "MEASURED", percent: 50, completed: 1, eligible: 2 });
  });

  it("excludes subtasks from the denominator entirely (only root-level tasks count)", () => {
    const tasks = [task("root", "TODO"), task("sub", "DONE", "root")];
    // Only "root" is eligible (parentTaskId === null) — the subtask's own DONE status never appears as a second, separately-counted completion.
    expect(calculateProjectProgress(tasks)).toEqual({ kind: "MEASURED", percent: 0, completed: 0, eligible: 1 });
  });

  it("rounds to the nearest whole percent", () => {
    const tasks = [task("1", "DONE"), task("2", "TODO"), task("3", "TODO")];
    expect(calculateProjectProgress(tasks)).toEqual({ kind: "MEASURED", percent: 33, completed: 1, eligible: 3 });
  });

  it("100% when every eligible task is done", () => {
    const tasks = [task("1", "DONE"), task("2", "DONE")];
    expect(calculateProjectProgress(tasks)).toEqual({ kind: "MEASURED", percent: 100, completed: 2, eligible: 2 });
  });
});

describe("evaluateProjectCompletionCriteria", () => {
  const noMilestones: { id: string; cancelledAt: Date | null }[] = [];
  const emptyProgress = new Map();

  it("met when there are no tasks, milestones, QA, or approvals at all", () => {
    const result = evaluateProjectCompletionCriteria({ tasks: [], milestones: noMilestones, milestoneProgressById: emptyProgress, qaChecks: [], approvals: [] });
    expect(result).toEqual({ met: true, unmet: [] });
  });

  it("blocks on an incomplete root task", () => {
    const result = evaluateProjectCompletionCriteria({
      tasks: [task("1", "TODO")],
      milestones: noMilestones,
      milestoneProgressById: emptyProgress,
      qaChecks: [],
      approvals: [],
    });
    expect(result.met).toBe(false);
    expect(result.unmet).toContain("TASKS");
  });

  it("does not block on an incomplete SUBTASK directly (only root tasks are checked)", () => {
    const result = evaluateProjectCompletionCriteria({
      tasks: [task("root", "DONE"), task("sub", "TODO", "root")],
      milestones: noMilestones,
      milestoneProgressById: emptyProgress,
      qaChecks: [],
      approvals: [],
    });
    expect(result.unmet).not.toContain("TASKS");
  });

  it("does not block on a cancelled task", () => {
    const result = evaluateProjectCompletionCriteria({
      tasks: [task("1", "CANCELLED")],
      milestones: noMilestones,
      milestoneProgressById: emptyProgress,
      qaChecks: [],
      approvals: [],
    });
    expect(result.unmet).not.toContain("TASKS");
  });

  it("blocks on an incomplete (non-cancelled, non-empty) milestone", () => {
    const result = evaluateProjectCompletionCriteria({
      tasks: [],
      milestones: [{ id: "m1", cancelledAt: null }],
      milestoneProgressById: new Map([["m1", { kind: "MEASURED", percent: 50, completed: 1, eligible: 2 }]]),
      qaChecks: [],
      approvals: [],
    });
    expect(result.unmet).toContain("MILESTONES");
  });

  it("does not block on a cancelled milestone", () => {
    const result = evaluateProjectCompletionCriteria({
      tasks: [],
      milestones: [{ id: "m1", cancelledAt: new Date() }],
      milestoneProgressById: new Map([["m1", { kind: "MEASURED", percent: 50, completed: 1, eligible: 2 }]]),
      qaChecks: [],
      approvals: [],
    });
    expect(result.unmet).not.toContain("MILESTONES");
  });

  it("does not block on an EMPTY (NOT_MEASURABLE) milestone — nothing outstanding to finish", () => {
    const result = evaluateProjectCompletionCriteria({
      tasks: [],
      milestones: [{ id: "m1", cancelledAt: null }],
      milestoneProgressById: new Map([["m1", { kind: "NOT_MEASURABLE" }]]),
      qaChecks: [],
      approvals: [],
    });
    expect(result.unmet).not.toContain("MILESTONES");
  });

  it("blocks on a required QA check that is PENDING or FAILED, never on an optional one", () => {
    const pending = evaluateProjectCompletionCriteria({ tasks: [], milestones: noMilestones, milestoneProgressById: emptyProgress, qaChecks: [{ required: true, status: "PENDING" }], approvals: [] });
    expect(pending.unmet).toContain("QA");

    const failed = evaluateProjectCompletionCriteria({ tasks: [], milestones: noMilestones, milestoneProgressById: emptyProgress, qaChecks: [{ required: true, status: "FAILED" }], approvals: [] });
    expect(failed.unmet).toContain("QA");

    const optionalPending = evaluateProjectCompletionCriteria({ tasks: [], milestones: noMilestones, milestoneProgressById: emptyProgress, qaChecks: [{ required: false, status: "PENDING" }], approvals: [] });
    expect(optionalPending.unmet).not.toContain("QA");

    const waived = evaluateProjectCompletionCriteria({ tasks: [], milestones: noMilestones, milestoneProgressById: emptyProgress, qaChecks: [{ required: true, status: "WAIVED" }], approvals: [] });
    expect(waived.unmet).not.toContain("QA");
  });

  it("blocks on any approval that is not APPROVED", () => {
    const pending = evaluateProjectCompletionCriteria({ tasks: [], milestones: noMilestones, milestoneProgressById: emptyProgress, qaChecks: [], approvals: [{ status: "PENDING" }] });
    expect(pending.unmet).toContain("APPROVALS");

    const rejected = evaluateProjectCompletionCriteria({ tasks: [], milestones: noMilestones, milestoneProgressById: emptyProgress, qaChecks: [], approvals: [{ status: "REJECTED" }] });
    expect(rejected.unmet).toContain("APPROVALS");

    const approved = evaluateProjectCompletionCriteria({ tasks: [], milestones: noMilestones, milestoneProgressById: emptyProgress, qaChecks: [], approvals: [{ status: "APPROVED" }] });
    expect(approved.unmet).not.toContain("APPROVALS");
  });
});
