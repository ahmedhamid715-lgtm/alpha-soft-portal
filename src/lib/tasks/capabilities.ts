import type { NormalizedTaskStatus, TaskItemCapabilities, TaskSourceType } from "./types";

/**
 * Pure per-source display/capability logic for Task Management (Build
 * 28 — Roadmap Module 22) — no DB, no auth resolution, safe to unit
 * test directly. Extracted out of `global-task-service.ts` (which
 * pulls in the DB client and every source service at import time) so
 * this logic can be exercised without any of that, matching every
 * other pure piece of `src/lib/tasks/`.
 */

/** Deep link to the AUTHORITATIVE source detail page — or, for `STANDALONE_TASK`, this module's own native detail page. Never a fake duplicate editable copy of source content. */
export function hrefFor(sourceType: TaskSourceType, sourceId: string, contextProjectId: string | null, contextOnboardingId: string | null): string {
  switch (sourceType) {
    case "PROJECT_TASK":
      return contextProjectId ? `/admin/projects/${contextProjectId}` : "/admin/projects";
    case "CRM_TASK":
      return "/admin/crm/tasks";
    case "ONBOARDING_CHECKLIST":
    case "ONBOARDING_REQUIREMENT":
      return contextOnboardingId ? `/admin/crm/onboarding/${contextOnboardingId}` : "/admin/crm/onboarding";
    case "STANDALONE_TASK":
      return `/admin/tasks/${sourceId}`;
  }
}

/**
 * UX-only capability flags — "what does this source adapter report a
 * task in this state CAN do." `canManageSource` is the caller's own
 * already-resolved manage-permission check for this row's source; this
 * function adds no authorization of its own, only per-source lifecycle
 * shape (e.g. `CrmTask` never reopens; onboarding items never
 * reassign/change due date/cancel through this module). The server
 * independently re-authorizes and re-validates every action regardless
 * of what this object says — see docs/architecture/task-management.md
 * "Quick actions."
 */
export function capabilitiesFor(sourceType: TaskSourceType, status: NormalizedTaskStatus, canManageSource: boolean): TaskItemCapabilities {
  const notTerminal = status !== "COMPLETED" && status !== "CANCELLED";
  switch (sourceType) {
    case "PROJECT_TASK":
      return { canComplete: canManageSource && notTerminal, canReopen: canManageSource && status === "COMPLETED", canAssign: canManageSource, canChangeDueDate: canManageSource };
    case "CRM_TASK":
      return { canComplete: canManageSource && status === "OPEN", canReopen: false, canAssign: canManageSource, canChangeDueDate: canManageSource };
    case "ONBOARDING_CHECKLIST":
      return { canComplete: canManageSource && notTerminal, canReopen: canManageSource && status === "COMPLETED", canAssign: false, canChangeDueDate: false };
    case "ONBOARDING_REQUIREMENT":
      return { canComplete: canManageSource && notTerminal, canReopen: false, canAssign: false, canChangeDueDate: false };
    case "STANDALONE_TASK":
      return { canComplete: canManageSource && notTerminal, canReopen: canManageSource && status === "COMPLETED", canAssign: canManageSource, canChangeDueDate: canManageSource };
  }
}
