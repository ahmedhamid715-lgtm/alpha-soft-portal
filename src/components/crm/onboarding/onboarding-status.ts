import type { CrmClientOnboardingStatus, CrmClientOnboardingRequirementStatus, CrmClientOnboardingChecklistItemStatus, CrmClientOnboardingDocumentStatus } from "@/generated/prisma/client";

/** Maps each Build 23 lifecycle enum to the shared `StatusBadge` color vocabulary — one place, reused by every list/detail page, mirroring `proposal-status.ts`'s own precedent. */
export function onboardingStatusVariant(status: CrmClientOnboardingStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "NOT_STARTED":
      return "neutral";
    case "IN_PROGRESS":
      return "info";
    case "BLOCKED":
      return "warning";
    case "COMPLETED":
      return "success";
    case "CANCELLED":
      return "destructive";
  }
}

export function requirementStatusVariant(status: CrmClientOnboardingRequirementStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "PENDING":
      return "neutral";
    case "IN_PROGRESS":
      return "info";
    case "COMPLETE":
      return "success";
  }
}

export function checklistItemStatusVariant(status: CrmClientOnboardingChecklistItemStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "PENDING":
      return "neutral";
    case "IN_PROGRESS":
      return "info";
    case "COMPLETE":
      return "success";
  }
}

export function documentStatusVariant(status: CrmClientOnboardingDocumentStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "REQUESTED":
      return "warning";
    case "RECEIVED":
      return "success";
  }
}
