import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveTaskManagementScope } from "./task-shared";
import { assertPlatformStaffMember } from "../crm-shared";
import { internalTaskRepository } from "@/server/repositories/internal-task-repository";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { InternalTask } from "@/generated/prisma/client";
import type { OffsetPaginatedResult } from "@/lib/platform/pagination";

/**
 * Standalone `InternalTask` CRUD + lifecycle (Build 28 — Roadmap Module
 * 22) — the ONE genuinely standalone task entity this module owns, for
 * work belonging to no existing domain. `task_management.manage` for
 * every mutation; `task_management.read` for listing (matches this
 * permission's own "use the Task Management surface" scope).
 */

interface InternalTaskAssignedPayload {
  taskId: string;
  organizationId: string;
  assignedToUserId: string;
  title: string;
}

async function auditTask(
  context: AuthorizationContext,
  action: "tasks.internal_task_created" | "tasks.internal_task_assigned" | "tasks.internal_task_status_changed" | "tasks.internal_task_due_date_changed",
  organizationId: string,
  task: InternalTask,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await audit
    .recordSuccess({ action, organizationId, resourceType: "internal_task", resourceId: task.id, resourceName: task.title, metadata, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error(`[audit] failed to record ${action}`, error));
}

async function notifyAssigned(task: InternalTask): Promise<void> {
  await events.emit<InternalTaskAssignedPayload>("task_management.internal_task_assigned", { taskId: task.id, organizationId: task.organizationId, assignedToUserId: task.assignedToUserId!, title: task.title });
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  assignedToUserId: z.string().uuid().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
});

export async function createInternalTask(rawInput: unknown): Promise<InternalTask> {
  const input = parseOrThrow(createSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveTaskManagementScope("task_management.manage");

  const task = await withTenantContext(tenantScope, async (tx) => {
    if (input.assignedToUserId) await assertPlatformStaffMember(input.assignedToUserId, organizationId, tx);
    return internalTaskRepository.create(
      { id: generateId(), organizationId, title: input.title, description: input.description ?? null, priority: input.priority, assignedToUserId: input.assignedToUserId ?? null, dueAt: input.dueAt ?? null, createdByUserId: context.user!.id },
      tx,
    );
  });

  await auditTask(context, "tasks.internal_task_created", organizationId, task);
  if (task.assignedToUserId) {
    await auditTask(context, "tasks.internal_task_assigned", organizationId, task, { assignedToUserId: task.assignedToUserId });
    await notifyAssigned(task);
  }
  return task;
}

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  assignedToUserId: z.string().uuid().optional(),
});

export async function listInternalTasks(rawInput: unknown): Promise<OffsetPaginatedResult<InternalTask>> {
  const input = parseOrThrow(listSchema, rawInput);
  const { tenantScope, organizationId } = await resolveTaskManagementScope("task_management.read");
  return withTenantContext(tenantScope, (tx) => internalTaskRepository.listForOrganization(organizationId, { page: input.page, limit: input.limit }, { status: input.status, assignedToUserId: input.assignedToUserId }, tx));
}

export async function getInternalTask(rawInput: unknown): Promise<InternalTask> {
  const input = parseOrThrow(z.object({ taskId: z.string().uuid() }), rawInput);
  const { tenantScope, organizationId } = await resolveTaskManagementScope("task_management.read");
  const task = await withTenantContext(tenantScope, (tx) => internalTaskRepository.findById(input.taskId, tx));
  if (!task || task.organizationId !== organizationId) throw new NotFoundError("Task");
  return task;
}

const updateSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
});

export async function updateInternalTask(rawInput: unknown): Promise<InternalTask> {
  const input = parseOrThrow(updateSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveTaskManagementScope("task_management.manage");

  const { task, assigneeChanged, dueDateChanged } = await withTenantContext(tenantScope, async (tx) => {
    const existing = await internalTaskRepository.findById(input.taskId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Task");
    if (input.assignedToUserId !== undefined && input.assignedToUserId !== null) await assertPlatformStaffMember(input.assignedToUserId, organizationId, tx);

    const { taskId, ...data } = input;
    const task = await internalTaskRepository.update(taskId, data, tx);
    const assigneeChanged = input.assignedToUserId !== undefined && input.assignedToUserId !== existing.assignedToUserId;
    const dueDateChanged = input.dueAt !== undefined && input.dueAt?.getTime() !== existing.dueAt?.getTime();
    return { task, assigneeChanged, dueDateChanged };
  });

  if (assigneeChanged) {
    await auditTask(context, "tasks.internal_task_assigned", organizationId, task, { assignedToUserId: task.assignedToUserId });
    if (task.assignedToUserId) await notifyAssigned(task);
  }
  if (dueDateChanged) await auditTask(context, "tasks.internal_task_due_date_changed", organizationId, task, { dueAt: task.dueAt });
  return task;
}

const taskIdSchema = z.object({ taskId: z.string().uuid() });

export async function completeInternalTask(rawInput: unknown): Promise<InternalTask> {
  const input = parseOrThrow(taskIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveTaskManagementScope("task_management.manage");

  const task = await withTenantContext(tenantScope, async (tx) => {
    const existing = await internalTaskRepository.findById(input.taskId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Task");
    if (existing.status === "COMPLETED" || existing.status === "CANCELLED") throw new ValidationError(`Cannot complete a task from ${existing.status}.`);
    const updated = await internalTaskRepository.complete(input.taskId, context.user!.id, tx);
    if (!updated) throw new ConflictError("This task was just changed by someone else. Reload and try again.");
    return updated;
  });

  await auditTask(context, "tasks.internal_task_status_changed", organizationId, task, { to: "COMPLETED" });
  return task;
}

export async function reopenInternalTask(rawInput: unknown): Promise<InternalTask> {
  const input = parseOrThrow(taskIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveTaskManagementScope("task_management.manage");

  const task = await withTenantContext(tenantScope, async (tx) => {
    const existing = await internalTaskRepository.findById(input.taskId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Task");
    if (existing.status !== "COMPLETED") throw new ValidationError("Only a completed task can be reopened.");
    const updated = await internalTaskRepository.reopen(input.taskId, tx);
    if (!updated) throw new ConflictError("This task was just changed by someone else. Reload and try again.");
    return updated;
  });

  await auditTask(context, "tasks.internal_task_status_changed", organizationId, task, { to: "OPEN", reopened: true });
  return task;
}

const cancelSchema = z.object({ taskId: z.string().uuid(), reason: z.string().trim().min(1, "A reason is required.").max(1000) });

export async function cancelInternalTask(rawInput: unknown): Promise<InternalTask> {
  const input = parseOrThrow(cancelSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveTaskManagementScope("task_management.manage");

  const task = await withTenantContext(tenantScope, async (tx) => {
    const existing = await internalTaskRepository.findById(input.taskId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Task");
    if (existing.status === "COMPLETED" || existing.status === "CANCELLED") throw new ValidationError(`Cannot cancel a task from ${existing.status}.`);
    const updated = await internalTaskRepository.cancel(input.taskId, { cancelledReason: input.reason, cancelledByUserId: context.user!.id }, tx);
    if (!updated) throw new ConflictError("This task was just changed by someone else. Reload and try again.");
    return updated;
  });

  await auditTask(context, "tasks.internal_task_status_changed", organizationId, task, { to: "CANCELLED", reason: input.reason });
  return task;
}

export type { InternalTaskAssignedPayload };
