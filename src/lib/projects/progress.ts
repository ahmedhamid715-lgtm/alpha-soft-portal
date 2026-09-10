/**
 * Deterministic Project Management progress/completion math (Build 27 —
 * Roadmap Module 21) — the ONE place these calculations live, the same
 * "pure, isomorphic, server-authoritative" discipline
 * `onboarding-progress.ts` (Build 23) established. Never let a client
 * submit an arbitrary percent-complete or a `COMPLETED` flag directly —
 * always recalculated here from the actual persisted state.
 *
 * See docs/architecture/project-management.md "Progress" for the full
 * formula writeup and the "never treat missing/cancelled work as bad
 * data" reasoning behind every zero-denominator/exclusion rule below.
 */

export type ProjectProgress = { kind: "NOT_MEASURABLE" } | { kind: "MEASURED"; percent: number; completed: number; eligible: number };

/**
 * The Customer Portal's own progress shape — `percent` only, deliberately
 * WITHOUT `completed`/`eligible` (Codex Security Engineer finding M2,
 * Build 27 review): those two counts let a customer back-calculate how
 * many hidden internal-only tasks exist and whether they're done, by
 * comparing this total against the customer-visible task list they can
 * already see. A bare percentage reveals no such structure.
 * `portal-project-service.ts`'s own `toPortalProgress()` is the one
 * place a real `ProjectProgress` is narrowed down to this shape.
 */
export type PortalProgress = { kind: "NOT_MEASURABLE" } | { kind: "MEASURED"; percent: number };

export function toPortalProgress(progress: ProjectProgress): PortalProgress {
  return progress.kind === "NOT_MEASURABLE" ? progress : { kind: "MEASURED", percent: progress.percent };
}

export interface ProgressTaskInput {
  id: string;
  status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED";
  /** `null` for a root task; set for a subtask. Subtasks are excluded from milestone/project progress denominators — their own completion is reflected through their PARENT task's completion instead, never counted a second time (see project-management.md "Progress" — "Milestone/Project progress counts root-level ProjectTasks only"). */
  parentTaskId: string | null;
}

/**
 * Task "progress" itself is binary — DONE is the only complete state.
 * CANCELLED tasks are EXCLUDED from every denominator below (never
 * counted as either complete or incomplete — descoped work should
 * never punish a project's own measured progress). This function is
 * the shared eligibility+completion filter both milestone and project
 * progress build on.
 */
function eligibleRootTasks(tasks: ProgressTaskInput[]): ProgressTaskInput[] {
  return tasks.filter((t) => t.parentTaskId === null && t.status !== "CANCELLED");
}

function toProgress(eligible: ProgressTaskInput[]): ProjectProgress {
  if (eligible.length === 0) return { kind: "NOT_MEASURABLE" };
  const completed = eligible.filter((t) => t.status === "DONE").length;
  return { kind: "MEASURED", percent: Math.round((completed / eligible.length) * 100), completed, eligible: eligible.length };
}

/** Milestone progress — root-level, non-cancelled tasks belonging to THIS milestone only. Zero eligible tasks (a milestone with no tasks yet, or every task cancelled) is `NOT_MEASURABLE`, never a fabricated 0%. */
export function calculateMilestoneProgress(tasks: ProgressTaskInput[]): ProjectProgress {
  return toProgress(eligibleRootTasks(tasks));
}

/** Project progress — every root-level, non-cancelled task in the project, regardless of milestone (milestone-less tasks count too). Zero eligible tasks (a brand-new project) is `NOT_MEASURABLE`, never a fabricated 0%. */
export function calculateProjectProgress(tasks: ProgressTaskInput[]): ProjectProgress {
  return toProgress(eligibleRootTasks(tasks));
}

export interface ProjectCompletionInput {
  /** Root-level tasks only — see `calculateProjectProgress()`'s own reasoning for why subtasks aren't checked directly here (a subtask left undone blocks its own PARENT task's completion first, which is itself a required root task). */
  tasks: { id: string; status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED"; parentTaskId: string | null }[];
  milestones: { id: string; cancelledAt: Date | null }[];
  /** Precomputed by the caller via `calculateMilestoneProgress()` per milestone — kept as an input rather than recomputed here so this function stays a pure aggregator, not a second copy of the same math. */
  milestoneProgressById: Map<string, ProjectProgress>;
  qaChecks: { required: boolean; status: "PENDING" | "PASSED" | "FAILED" | "WAIVED" }[];
  approvals: { status: "PENDING" | "APPROVED" | "REJECTED" }[];
}

export interface ProjectCompletionResult {
  met: boolean;
  /** Which specific gate(s) are still open — surfaced to the UI so "why can't this project complete" is always answerable, never a bare boolean. Mirrors `CompletionCriteriaResult` (Build 23) exactly. */
  unmet: ("TASKS" | "MILESTONES" | "QA" | "APPROVALS")[];
}

/**
 * Project completion criteria (frozen): every required (non-cancelled)
 * root task is DONE, every non-cancelled milestone is fully measured-
 * complete (100%, or genuinely `NOT_MEASURABLE` because it has zero
 * tasks — an EMPTY milestone never blocks completion, since there is
 * nothing outstanding to finish), every REQUIRED QA check is PASSED or
 * WAIVED (FAILED or PENDING blocks), and every approval is APPROVED
 * (PENDING or REJECTED blocks). A privileged `completionOverride` is
 * the only bypass, handled entirely at the service layer — this
 * function only ever reports the TRUE criteria state, never the
 * override (exact same discipline `evaluateCompletionCriteria()`,
 * Build 23, already established).
 */
export function evaluateProjectCompletionCriteria(input: ProjectCompletionInput): ProjectCompletionResult {
  const unmet: ProjectCompletionResult["unmet"] = [];

  const incompleteTasks = input.tasks.filter((t) => t.parentTaskId === null && t.status !== "CANCELLED" && t.status !== "DONE");
  if (incompleteTasks.length > 0) unmet.push("TASKS");

  const activeMilestones = input.milestones.filter((m) => m.cancelledAt === null);
  const incompleteMilestone = activeMilestones.some((m) => {
    const progress = input.milestoneProgressById.get(m.id);
    return progress?.kind === "MEASURED" && progress.percent < 100;
  });
  if (incompleteMilestone) unmet.push("MILESTONES");

  const failedOrPendingRequiredQa = input.qaChecks.some((q) => q.required && q.status !== "PASSED" && q.status !== "WAIVED");
  if (failedOrPendingRequiredQa) unmet.push("QA");

  const unresolvedApproval = input.approvals.some((a) => a.status !== "APPROVED");
  if (unresolvedApproval) unmet.push("APPROVALS");

  return { met: unmet.length === 0, unmet };
}
