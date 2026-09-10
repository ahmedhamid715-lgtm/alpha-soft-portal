import type { ProjectStatus, ProjectTaskStatus, ProjectPriority, ProjectApprovalStatus, ProjectQaCheckStatus } from "@/generated/prisma/client";

type Variant = "neutral" | "success" | "warning" | "destructive" | "info" | "primary";

/** Maps each Build 27 lifecycle enum to the shared `StatusBadge` color vocabulary — one place, reused by every list/detail page, mirroring `onboarding-status.ts`'s own precedent. */
export function projectStatusVariant(status: ProjectStatus): Variant {
  switch (status) {
    case "DRAFT":
      return "neutral";
    case "PLANNED":
      return "info";
    case "ACTIVE":
      return "primary";
    case "ON_HOLD":
      return "warning";
    case "COMPLETED":
      return "success";
    case "CANCELLED":
      return "destructive";
    case "ARCHIVED":
      return "neutral";
  }
}

export function projectTaskStatusVariant(status: ProjectTaskStatus): Variant {
  switch (status) {
    case "TODO":
      return "neutral";
    case "IN_PROGRESS":
      return "info";
    case "BLOCKED":
      return "warning";
    case "DONE":
      return "success";
    case "CANCELLED":
      return "destructive";
  }
}

export function projectPriorityVariant(priority: ProjectPriority): Variant {
  switch (priority) {
    case "LOW":
      return "neutral";
    case "MEDIUM":
      return "info";
    case "HIGH":
      return "warning";
    case "URGENT":
      return "destructive";
  }
}

export function projectApprovalStatusVariant(status: ProjectApprovalStatus): Variant {
  switch (status) {
    case "PENDING":
      return "warning";
    case "APPROVED":
      return "success";
    case "REJECTED":
      return "destructive";
  }
}

export function projectQaCheckStatusVariant(status: ProjectQaCheckStatus): Variant {
  switch (status) {
    case "PENDING":
      return "neutral";
    case "PASSED":
      return "success";
    case "FAILED":
      return "destructive";
    case "WAIVED":
      return "info";
  }
}
