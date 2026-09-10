import type { NormalizedTaskStatus, TaskSourceType } from "./types";

/**
 * Display-only helpers for the Task Management UI (Build 28 — Roadmap
 * Module 22) — badge variants and source labels. Pure presentation, no
 * fetching, so it's safe to import from both server and client
 * components. `TaskItem.priority` reuses `ProjectPriority` directly, so
 * priority badges reuse `projectPriorityVariant()` from
 * `@/components/projects/project-status` instead of duplicating it here.
 */

type BadgeVariant = "neutral" | "success" | "warning" | "destructive" | "info" | "primary";

export function taskStatusVariant(status: NormalizedTaskStatus): BadgeVariant {
  switch (status) {
    case "OPEN":
      return "neutral";
    case "IN_PROGRESS":
      return "info";
    case "BLOCKED":
      return "warning";
    case "COMPLETED":
      return "success";
    case "CANCELLED":
      return "neutral";
  }
}

export const TASK_SOURCE_LABELS: Record<TaskSourceType, string> = {
  PROJECT_TASK: "Project",
  CRM_TASK: "CRM",
  ONBOARDING_CHECKLIST: "Onboarding checklist",
  ONBOARDING_REQUIREMENT: "Onboarding requirement",
  STANDALONE_TASK: "Internal",
};

export function taskSourceVariant(sourceType: TaskSourceType): BadgeVariant {
  switch (sourceType) {
    case "PROJECT_TASK":
      return "primary";
    case "CRM_TASK":
      return "info";
    case "ONBOARDING_CHECKLIST":
    case "ONBOARDING_REQUIREMENT":
      return "warning";
    case "STANDALONE_TASK":
      return "neutral";
  }
}
