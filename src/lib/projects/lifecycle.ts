/**
 * Project/ProjectTask lifecycle state machines (Build 27 — Roadmap
 * Module 21) — pure, isomorphic, server-authoritative. The UI is never
 * lifecycle authority; every transition request is validated against
 * these tables before any write happens, and every terminal transition
 * is additionally CAS-guarded at the repository layer (see
 * project-service.ts/project-task-service.ts).
 */

export type ProjectStatus = "DRAFT" | "PLANNED" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED" | "ARCHIVED";

/**
 * Allowed transitions. COMPLETED → ACTIVE (reopening) is intentionally
 * allowed — a client requesting late changes to "finished" work is a
 * real, common scenario — but the service layer treats it as a
 * privileged, audited action (`crm.onboarding`'s own "reopened after
 * completion" precedent), never a bare status PATCH. ARCHIVED has no
 * outgoing transitions at all — archival is a final, soft-hide state,
 * never a delete and never reversible through this state machine (an
 * archived project can still be read, just not acted on further).
 */
const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  DRAFT: ["PLANNED", "CANCELLED"],
  PLANNED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["ON_HOLD", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["ACTIVE", "CANCELLED"],
  COMPLETED: ["ACTIVE", "ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  ARCHIVED: [],
};

export const PROJECT_TERMINAL_STATUSES: ProjectStatus[] = ["COMPLETED", "CANCELLED", "ARCHIVED"];

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_TRANSITIONS[from].includes(to);
}

export type ProjectTaskStatus = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED";

/**
 * Starting work (→ IN_PROGRESS) is NEVER structurally blocked by open
 * dependencies — parallel/anticipatory work is realistic and this
 * state machine alone has no opinion on it. Completing (→ DONE) IS
 * gated by open dependencies, but that gate lives in the SERVICE layer
 * (`completeTask()`, which checks `dependsOnTaskId` tasks are all
 * DONE/CANCELLED before allowing the transition) — this table only
 * describes which STATUS VALUES are reachable from which, not the
 * extra business precondition layered on top of the DONE edge. DONE
 * and CANCELLED are both terminal; DONE → anything is a real "reopen"
 * (privileged, audited — see project-management.md "Task status").
 */
const TASK_TRANSITIONS: Record<ProjectTaskStatus, ProjectTaskStatus[]> = {
  TODO: ["IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"],
  IN_PROGRESS: ["BLOCKED", "DONE", "CANCELLED", "TODO"],
  BLOCKED: ["IN_PROGRESS", "TODO", "DONE", "CANCELLED"],
  DONE: ["TODO", "IN_PROGRESS", "CANCELLED"],
  CANCELLED: [],
};

export const TASK_TERMINAL_STATUSES: ProjectTaskStatus[] = ["DONE", "CANCELLED"];

export function canTransitionTask(from: ProjectTaskStatus, to: ProjectTaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}
