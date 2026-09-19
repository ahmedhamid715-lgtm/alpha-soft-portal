import type { GhlWorkspaceStatus, GhlAssetImplementationStatus, GhlHandoffStatus, GhlAssetType, GhlIntegrationRequirementStatus } from "@/generated/prisma/client";
import type { GhlReadinessStatus } from "@/lib/ghl/readiness";

/** Maps every GHL Automation status enum to the shared `StatusBadge` color vocabulary — one place, reused by every list/detail page (Build 34 — Roadmap Module 28), mirroring `ecommerce-status.ts`'s own precedent. */
export function ghlWorkspaceStatusVariant(status: GhlWorkspaceStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "PLANNING":
      return "neutral";
    case "IN_DEVELOPMENT":
      return "info";
    case "LIVE":
      return "success";
    case "MAINTENANCE":
      return "info";
    case "ARCHIVED":
      return "neutral";
  }
}

export function ghlAssetStatusVariant(status: GhlAssetImplementationStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "PLANNED":
      return "neutral";
    case "IN_PROGRESS":
      return "info";
    case "READY_FOR_QA":
      return "warning";
    case "QA_FAILED":
      return "destructive";
    case "READY":
      return "info";
    case "LIVE":
      return "success";
    case "ARCHIVED":
      return "neutral";
  }
}

export function ghlHandoffStatusVariant(status: GhlHandoffStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "NOT_STARTED":
      return "neutral";
    case "IN_PROGRESS":
      return "warning";
    case "COMPLETED":
      return "success";
  }
}

export function ghlIntegrationRequirementStatusVariant(status: GhlIntegrationRequirementStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "NOT_CONFIGURED":
      return "neutral";
    case "CONFIGURED":
      return "warning";
    case "CONFIRMED":
      return "success";
  }
}

export function ghlReadinessVariant(status: GhlReadinessStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "READY":
      return "success";
    case "NOT_READY":
      return "warning";
    case "NOT_MEASURABLE":
      return "neutral";
  }
}

export const GHL_ASSET_TYPE_LABELS: Record<GhlAssetType, string> = {
  FUNNEL: "Funnel",
  FORM: "Form",
  SURVEY: "Survey",
  CALENDAR: "Calendar",
  PIPELINE: "Pipeline",
  WORKFLOW: "Workflow",
  TRIGGER: "Trigger",
  CUSTOM_FIELD: "Custom field",
  EMAIL_TEMPLATE: "Email template",
  SMS_TEMPLATE: "SMS template",
  SNAPSHOT: "Snapshot",
  OTHER: "Other",
};
