import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveTaskManagementScope } from "./task-shared";
import { globalTaskQueryRepository, type GlobalTaskRow } from "@/server/repositories/global-task-query-repository";
import { db } from "@/lib/db/client";
import { normalizeTaskStatus } from "@/lib/tasks/status";
import { isOverdue, classifyDueWindow, type DueWindow } from "@/lib/tasks/due-window";
import { hrefFor, capabilitiesFor } from "@/lib/tasks/capabilities";
import { taskItemKeyToString, parseTaskItemKey, type TaskItem, type TaskSourceType, type NormalizedTaskStatus } from "@/lib/tasks/types";
import { NotFoundError, ValidationError } from "@/lib/errors/app-error";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { PermissionKey } from "@/lib/authorization/permissions";
import type { ProjectPriority } from "@/generated/prisma/client";

import { completeTask as completeProjectTask, cancelTask as cancelProjectTask, transitionTask as transitionProjectTask, updateTask as updateProjectTask } from "../project-task-service";
import { completeTask as completeCrmTask, cancelTask as cancelCrmTask, updateTask as updateCrmTask } from "../crm-task-service";
import { completeRequirement } from "../crm-client-onboarding-checklist-service";
import { completeChecklistItem, reopenChecklistItem } from "../crm-client-onboarding-checklist-service";
import { completeInternalTask, reopenInternalTask, cancelInternalTask, updateInternalTask } from "./internal-task-service";

/**
 * The Build 28 (Task Management) global read/mutation orchestrator —
 * ties together the raw cross-source SQL union
 * (`global-task-query-repository.ts`), per-source authorization
 * (checked here, ONCE, against the already-resolved
 * `AuthorizationContext.permissions` set — never a second round-trip
 * per source), normalization (`src/lib/tasks/*`), bounded display-
 * context batching, and mutation delegation to each source's own
 * authoritative service.
 *
 * **Authorization intersection — the load-bearing security property of
 * this whole module** (see docs/architecture/task-management.md): a
 * source branch is included in the union ONLY when the caller
 * independently holds that source's OWN read permission. Holding
 * `task_management.read`/`.team_read` never widens what a caller can
 * see — it only grants access to this AGGREGATION SURFACE itself.
 */

const SOURCE_PERMISSION: Record<Exclude<TaskSourceType, "STANDALONE_TASK">, PermissionKey> = {
  PROJECT_TASK: "delivery_projects.read",
  CRM_TASK: "crm.read",
  ONBOARDING_CHECKLIST: "crm.onboarding.read",
  ONBOARDING_REQUIREMENT: "crm.onboarding.read",
};

/** The caller's own authorization-filtered source list — NEVER derived from client input. `STANDALONE_TASK` is gated by `task_management.read` itself (this module's own domain). */
function authorizedSourceTypes(context: AuthorizationContext): TaskSourceType[] {
  const sources: TaskSourceType[] = ["STANDALONE_TASK"];
  for (const [sourceType, permission] of Object.entries(SOURCE_PERMISSION) as [TaskSourceType, PermissionKey][]) {
    if (context.permissions.has(permission)) sources.push(sourceType);
  }
  return sources;
}

const MANAGE_PERMISSION: Record<TaskSourceType, PermissionKey> = {
  PROJECT_TASK: "delivery_projects.manage",
  CRM_TASK: "crm.manage",
  ONBOARDING_CHECKLIST: "crm.onboarding.manage",
  ONBOARDING_REQUIREMENT: "crm.onboarding.manage",
  STANDALONE_TASK: "task_management.manage",
};

interface DisplayContext {
  assigneeNames: Map<string, string>;
  projectTitles: Map<string, string>;
  onboardingCompanyNames: Map<string, string>;
  crmCompanyNames: Map<string, string>;
}

/** Bounded batch resolve — one query per distinct-id-type, keyed off ONLY the ids present on the current PAGE (never the full result set), never per-row. */
async function resolveDisplayContext(rows: GlobalTaskRow[]): Promise<DisplayContext> {
  const assigneeIds = [...new Set(rows.map((r) => r.assignedToUserId).filter((id): id is string => id !== null))];
  const projectIds = [...new Set(rows.map((r) => r.contextProjectId).filter((id): id is string => id !== null))];
  const onboardingIds = [...new Set(rows.map((r) => r.contextOnboardingId).filter((id): id is string => id !== null))];
  const companyIds = [...new Set(rows.map((r) => r.contextCompanyId).filter((id): id is string => id !== null))];

  const [users, projects, onboardings, companies] = await Promise.all([
    assigneeIds.length > 0 ? db.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    projectIds.length > 0 ? db.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, title: true } }) : Promise.resolve([]),
    onboardingIds.length > 0 ? db.crmClientOnboarding.findMany({ where: { id: { in: onboardingIds } }, select: { id: true, linkedOrganization: { select: { displayName: true } } } }) : Promise.resolve([]),
    companyIds.length > 0 ? db.crmCompany.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);

  return {
    assigneeNames: new Map(users.map((u) => [u.id, u.name])),
    projectTitles: new Map(projects.map((p) => [p.id, p.title])),
    onboardingCompanyNames: new Map(onboardings.map((o) => [o.id, o.linkedOrganization.displayName])),
    crmCompanyNames: new Map(companies.map((c) => [c.id, c.name])),
  };
}

function toTaskItem(row: GlobalTaskRow, context: AuthorizationContext, display: DisplayContext, now: Date): TaskItem {
  const status = normalizeTaskStatus(row.sourceType, row.statusRaw);
  const canManageSource = context.permissions.has(MANAGE_PERMISSION[row.sourceType]);
  return {
    key: taskItemKeyToString({ sourceType: row.sourceType, sourceId: row.sourceId }),
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    title: row.title,
    descriptionPreview: row.description ? row.description.slice(0, 160) : null,
    status,
    sourceStatus: row.statusRaw,
    priority: (row.priority as ProjectPriority | null) ?? null,
    assigneeUserId: row.assignedToUserId,
    assigneeName: row.assignedToUserId ? (display.assigneeNames.get(row.assignedToUserId) ?? null) : null,
    dueAt: row.dueAt,
    isOverdue: isOverdue(row.dueAt, status, now),
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    context: {
      companyName: row.contextCompanyId ? (display.crmCompanyNames.get(row.contextCompanyId) ?? null) : row.contextOnboardingId ? (display.onboardingCompanyNames.get(row.contextOnboardingId) ?? null) : null,
      projectId: row.contextProjectId,
      projectTitle: row.contextProjectId ? (display.projectTitles.get(row.contextProjectId) ?? null) : null,
      onboardingId: row.contextOnboardingId,
    },
    href: hrefFor(row.sourceType, row.sourceId, row.contextProjectId, row.contextOnboardingId),
    capabilities: capabilitiesFor(row.sourceType, status, canManageSource),
  };
}

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  scope: z.enum(["MY", "TEAM"]).default("MY"),
  assignedToUserId: z.string().uuid().optional(),
  status: z.array(z.enum(["OPEN", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"])).optional(),
  priority: z.array(z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"])).optional(),
  dueWindow: z.enum(["OVERDUE", "DUE_TODAY", "UPCOMING", "NO_DUE_DATE"]).optional(),
  search: z.string().trim().max(200).optional(),
  sourceTypes: z.array(z.enum(["PROJECT_TASK", "CRM_TASK", "ONBOARDING_CHECKLIST", "ONBOARDING_REQUIREMENT", "STANDALONE_TASK"])).optional(),
});

export interface GlobalTaskListResult {
  items: TaskItem[];
  page: number;
  limit: number;
  totalCount: number;
}

/**
 * `scope: "MY"` (default) — the current user's own assigned work,
 * requires only `task_management.read`. `scope: "TEAM"` — every other
 * platform staff member's assignments too, requires the SEPARATE
 * `task_management.team_read` authority. Either way, `sourceTypes` is
 * ALWAYS narrowed to `authorizedSourceTypes()` — a caller can request a
 * NARROWER `sourceTypes` subset via the input filter, but can never
 * widen it past what they're independently entitled to see.
 */
export async function listGlobalTasks(rawInput: unknown): Promise<GlobalTaskListResult> {
  const input = parseOrThrow(listSchema, rawInput);
  const permission = input.scope === "TEAM" ? "task_management.team_read" : "task_management.read";
  const { context, tenantScope, organizationId } = await resolveTaskManagementScope(permission);

  const allowedSources = authorizedSourceTypes(context);
  const requestedSources = input.sourceTypes ? input.sourceTypes.filter((s) => allowedSources.includes(s)) : allowedSources;

  const assignedToUserId = input.scope === "MY" ? context.user!.id : input.assignedToUserId;

  const filters = { sourceTypes: requestedSources, assignedToUserId, status: input.status as NormalizedTaskStatus[] | undefined, priority: input.priority, dueWindow: input.dueWindow as DueWindow | undefined, search: input.search };

  const { rows, totalCount } = await withTenantContext(tenantScope, async (tx) => {
    const [rows, totalCount] = await Promise.all([
      globalTaskQueryRepository.listPage(organizationId, filters, input.limit, (input.page - 1) * input.limit, tx),
      globalTaskQueryRepository.countAll(organizationId, filters, tx),
    ]);
    return { rows, totalCount };
  });

  const display = await resolveDisplayContext(rows);
  const now = new Date();
  return { items: rows.map((row) => toTaskItem(row, context, display, now)), page: input.page, limit: input.limit, totalCount };
}

/** Per-source, per-normalized-status counts for the current user's own "My Tasks" — powers the due-window/status chip counts without a second full list fetch. Bounded to the same authorized source set. */
export async function getMyTaskCounts(): Promise<{ overdue: number; dueToday: number; upcoming: number; noDueDate: number; completed: number }> {
  const { context, tenantScope, organizationId } = await resolveTaskManagementScope("task_management.read");
  const sourceTypes = authorizedSourceTypes(context);
  const assignedToUserId = context.user!.id;

  return withTenantContext(tenantScope, async (tx) => {
    const [overdue, dueToday, upcoming, noDueDate, completed] = await Promise.all([
      globalTaskQueryRepository.countAll(organizationId, { sourceTypes, assignedToUserId, dueWindow: "OVERDUE" }, tx),
      globalTaskQueryRepository.countAll(organizationId, { sourceTypes, assignedToUserId, dueWindow: "DUE_TODAY" }, tx),
      globalTaskQueryRepository.countAll(organizationId, { sourceTypes, assignedToUserId, dueWindow: "UPCOMING" }, tx),
      globalTaskQueryRepository.countAll(organizationId, { sourceTypes, assignedToUserId, dueWindow: "NO_DUE_DATE" }, tx),
      globalTaskQueryRepository.countAll(organizationId, { sourceTypes, assignedToUserId, status: ["COMPLETED"] }, tx),
    ]);
    return { overdue, dueToday, upcoming, noDueDate, completed };
  });
}

// --- Mutation delegation — SOURCE DOMAIN OWNS MUTATIONS AND LIFECYCLE
// RULES. Every function below is a thin dispatcher: it parses the
// global key, then calls the REAL source service, which independently
// re-resolves ITS OWN authorization (never trusts this module's own
// `task_management.*` grant as sufficient). A forged/unauthorized
// sourceId is rejected by that underlying service exactly as it would
// be if called directly — this dispatcher adds no privilege of its own.

const globalKeySchema = z.object({ key: z.string().min(1) });

function requireParsedKey(raw: unknown): { sourceType: TaskSourceType; sourceId: string } {
  const input = parseOrThrow(globalKeySchema, raw);
  const parsed = parseTaskItemKey(input.key);
  if (!parsed) throw new NotFoundError("Task");
  return parsed;
}

export async function completeGlobalTask(rawInput: unknown): Promise<void> {
  const { sourceType, sourceId } = requireParsedKey(rawInput);
  switch (sourceType) {
    case "PROJECT_TASK":
      await completeProjectTask({ taskId: sourceId });
      return;
    case "CRM_TASK":
      await completeCrmTask({ taskId: sourceId });
      return;
    case "ONBOARDING_CHECKLIST":
      await completeChecklistItem({ checklistItemId: sourceId });
      return;
    case "ONBOARDING_REQUIREMENT":
      await completeRequirement({ requirementId: sourceId });
      return;
    case "STANDALONE_TASK":
      await completeInternalTask({ taskId: sourceId });
      return;
  }
}

export async function reopenGlobalTask(rawInput: unknown): Promise<void> {
  const { sourceType, sourceId } = requireParsedKey(rawInput);
  switch (sourceType) {
    case "PROJECT_TASK":
      await transitionProjectTask({ taskId: sourceId, status: "TODO" });
      return;
    case "ONBOARDING_CHECKLIST":
      await reopenChecklistItem({ checklistItemId: sourceId });
      return;
    case "STANDALONE_TASK":
      await reopenInternalTask({ taskId: sourceId });
      return;
    case "CRM_TASK":
    case "ONBOARDING_REQUIREMENT":
      throw new ValidationError(`${sourceType} does not support reopening.`);
  }
}

const cancelSchema = z.object({ key: z.string().min(1), reason: z.string().trim().min(1).max(1000) });

export async function cancelGlobalTask(rawInput: unknown): Promise<void> {
  const input = parseOrThrow(cancelSchema, rawInput);
  const parsed = parseTaskItemKey(input.key);
  if (!parsed) throw new NotFoundError("Task");
  switch (parsed.sourceType) {
    case "PROJECT_TASK":
      await cancelProjectTask({ taskId: parsed.sourceId, reason: input.reason });
      return;
    case "CRM_TASK":
      await cancelCrmTask({ taskId: parsed.sourceId });
      return;
    case "STANDALONE_TASK":
      await cancelInternalTask({ taskId: parsed.sourceId, reason: input.reason });
      return;
    case "ONBOARDING_CHECKLIST":
    case "ONBOARDING_REQUIREMENT":
      throw new ValidationError(`${parsed.sourceType} does not support cancellation through Task Management.`);
  }
}

const assignSchema = z.object({ key: z.string().min(1), assignedToUserId: z.string().uuid().nullable() });

export async function assignGlobalTask(rawInput: unknown): Promise<void> {
  const input = parseOrThrow(assignSchema, rawInput);
  const parsed = parseTaskItemKey(input.key);
  if (!parsed) throw new NotFoundError("Task");
  switch (parsed.sourceType) {
    case "PROJECT_TASK":
      await updateProjectTask({ taskId: parsed.sourceId, assignedToUserId: input.assignedToUserId });
      return;
    case "CRM_TASK":
      await updateCrmTask({ taskId: parsed.sourceId, assignedToUserId: input.assignedToUserId });
      return;
    case "STANDALONE_TASK":
      await updateInternalTask({ taskId: parsed.sourceId, assignedToUserId: input.assignedToUserId });
      return;
    case "ONBOARDING_CHECKLIST":
    case "ONBOARDING_REQUIREMENT":
      throw new ValidationError(`${parsed.sourceType} does not support reassignment through Task Management.`);
  }
}

const changeDueDateSchema = z.object({ key: z.string().min(1), dueAt: z.coerce.date().nullable() });

export async function changeGlobalTaskDueDate(rawInput: unknown): Promise<void> {
  const input = parseOrThrow(changeDueDateSchema, rawInput);
  const parsed = parseTaskItemKey(input.key);
  if (!parsed) throw new NotFoundError("Task");
  switch (parsed.sourceType) {
    case "PROJECT_TASK":
      await updateProjectTask({ taskId: parsed.sourceId, dueDate: input.dueAt });
      return;
    case "CRM_TASK":
      await updateCrmTask({ taskId: parsed.sourceId, dueAt: input.dueAt });
      return;
    case "STANDALONE_TASK":
      await updateInternalTask({ taskId: parsed.sourceId, dueAt: input.dueAt });
      return;
    case "ONBOARDING_CHECKLIST":
    case "ONBOARDING_REQUIREMENT":
      throw new ValidationError(`${parsed.sourceType} does not support changing the due date through Task Management.`);
  }
}

export { classifyDueWindow };
export type { DueWindow };
