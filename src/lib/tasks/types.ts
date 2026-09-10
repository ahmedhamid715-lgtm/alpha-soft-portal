import type { ProjectPriority } from "@/generated/prisma/client";

/**
 * The Task Management (Build 28 — Roadmap Module 22) normalized read
 * contract — pure types only, no fetching. This is a VIEW CONTRACT, not
 * another authoritative persisted task: every `TaskItem` is a
 * hand-picked projection of a row that still lives, and is still
 * mutated, in its own owning source domain. See
 * docs/architecture/task-management.md "Global task representation."
 */

/** Frozen source-type list for this build — do not add an entity here merely because it "requires attention" (notifications/approvals/audit events/tickets/deals are explicitly NOT tasks). */
export type TaskSourceType = "PROJECT_TASK" | "CRM_TASK" | "ONBOARDING_CHECKLIST" | "ONBOARDING_REQUIREMENT" | "STANDALONE_TASK";

/**
 * A small, deliberately lossy semantic set for cross-source display/
 * filtering — NEVER a replacement for each source's own real lifecycle
 * enum (`sourceStatus` on `TaskItem` always carries the untranslated
 * original). Every mutation always routes back to the SOURCE domain's
 * own transition rules; this value is read-only display/filter sugar.
 */
export type NormalizedTaskStatus = "OPEN" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED";

export interface TaskItemKey {
  sourceType: TaskSourceType;
  sourceId: string;
}

/** `"PROJECT_TASK:<uuid>"` — a deterministic, typed global identifier. Never trust a caller-supplied key for authorization; always re-derive `sourceType`'s own permission check from the key's own `sourceType`, never skip it because the key "looks" well-formed. */
export function taskItemKeyToString(key: TaskItemKey): string {
  return `${key.sourceType}:${key.sourceId}`;
}

const TASK_SOURCE_TYPES: readonly TaskSourceType[] = ["PROJECT_TASK", "CRM_TASK", "ONBOARDING_CHECKLIST", "ONBOARDING_REQUIREMENT", "STANDALONE_TASK"];

/** Returns `null` (never throws) for a malformed/unknown key — callers must treat that as "not found," not as an internal error, since the input is client-controlled. */
export function parseTaskItemKey(raw: string): TaskItemKey | null {
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex <= 0) return null;
  const sourceType = raw.slice(0, separatorIndex);
  const sourceId = raw.slice(separatorIndex + 1);
  if (!sourceId || !(TASK_SOURCE_TYPES as string[]).includes(sourceType)) return null;
  return { sourceType: sourceType as TaskSourceType, sourceId };
}

/** Deep-link/display context — deliberately just names/ids for navigation, never a second copy of source content. */
export interface TaskItemContext {
  companyName: string | null;
  projectId: string | null;
  projectTitle: string | null;
  onboardingId: string | null;
}

/**
 * UX-only capability flags — "what does the source adapter report this
 * task CAN do." The server independently re-authorizes and re-validates
 * every action regardless of what this object says; see
 * docs/architecture/task-management.md "Quick actions" — "frontend
 * capability flags are UX, not security."
 */
export interface TaskItemCapabilities {
  canComplete: boolean;
  canReopen: boolean;
  canAssign: boolean;
  canChangeDueDate: boolean;
}

export interface TaskItem {
  key: string;
  sourceType: TaskSourceType;
  sourceId: string;
  title: string;
  descriptionPreview: string | null;
  status: NormalizedTaskStatus;
  /** The untranslated original status string from the source domain — never discarded. */
  sourceStatus: string;
  /** `null` means NOT_SET — a source with no priority concept (CrmTask, onboarding items) must never be shown/sorted as if it were LOW. */
  priority: ProjectPriority | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  dueAt: Date | null;
  isOverdue: boolean;
  createdAt: Date;
  completedAt: Date | null;
  context: TaskItemContext;
  /** Deep link to the authoritative source detail page (or, for STANDALONE_TASK, this module's own detail page). */
  href: string;
  capabilities: TaskItemCapabilities;
}
