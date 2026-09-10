import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveProjectScope, lockMutableProject } from "./project-shared";
import { assertPlatformStaffMember } from "./crm-shared";
import { milestoneRepository } from "@/server/repositories/milestone-repository";
import { projectTaskRepository } from "@/server/repositories/project-task-repository";
import { projectTaskDependencyRepository } from "@/server/repositories/project-task-dependency-repository";
import { canTransitionTask, type ProjectTaskStatus } from "@/lib/projects/lifecycle";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { Project, ProjectTask } from "@/generated/prisma/client";

/**
 * Project-scoped task (and one-level-deep subtask) CRUD + lifecycle
 * (Build 27 — Roadmap Module 21). **Boundary**: every row here is
 * `projectId`-scoped by construction — this is NEVER the Roadmap 22
 * global task engine. See project-management.md "Project tasks — the
 * Roadmap 22 boundary."
 */

interface ProjectTaskAssignedPayload {
  taskId: string;
  projectId: string;
  organizationId: string;
  recipientUserId: string;
  projectTitle: string;
  taskTitle: string;
}
interface ProjectTaskBlockedPayload {
  taskId: string;
  projectId: string;
  organizationId: string;
  recipientUserId: string;
  projectTitle: string;
  taskTitle: string;
}

async function notifyTaskAssigned(task: ProjectTask, project: Project, organizationId: string): Promise<void> {
  if (!task.assignedToUserId) return;
  await events.emit<ProjectTaskAssignedPayload>("projects.task_assigned", { taskId: task.id, projectId: project.id, organizationId, recipientUserId: task.assignedToUserId, projectTitle: project.title, taskTitle: task.title });
}

const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  milestoneId: z.string().uuid().nullable().optional(),
  parentTaskId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  assignedToUserId: z.string().uuid().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  customerVisible: z.boolean().default(false),
});

export async function createTask(rawInput: unknown): Promise<ProjectTask> {
  const input = parseOrThrow(createTaskSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  const { task, project } = await withTenantContext(tenantScope, async (tx) => {
    const project = await lockMutableProject(input.projectId, organizationId, tx);

    if (input.milestoneId) {
      const milestone = await milestoneRepository.findById(input.milestoneId, tx);
      if (!milestone || milestone.projectId !== input.projectId) throw new ValidationError("milestoneId does not belong to this project.");
    }
    // One-level-deep nesting only (decision "Subtasks") — the DB trigger
    // enforces this too, but rejecting here gives a clean `ValidationError`
    // instead of a raw constraint violation.
    if (input.parentTaskId) {
      const parent = await projectTaskRepository.findById(input.parentTaskId, tx);
      if (!parent || parent.projectId !== input.projectId) throw new ValidationError("parentTaskId does not belong to this project.");
      if (parent.parentTaskId !== null) throw new ValidationError("Subtasks cannot themselves have subtasks — one level of nesting only.");
    }
    if (input.assignedToUserId) await assertPlatformStaffMember(input.assignedToUserId, organizationId, tx);

    const siblings = (await projectTaskRepository.listForProject(input.projectId, tx)).filter((t) => t.parentTaskId === (input.parentTaskId ?? null));
    const maxSortOrder = siblings.reduce((max, t) => Math.max(max, t.sortOrder), 0);

    const task = await projectTaskRepository.create(
      {
        id: generateId(),
        organizationId,
        projectId: input.projectId,
        milestoneId: input.milestoneId ?? null,
        parentTaskId: input.parentTaskId ?? null,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        assignedToUserId: input.assignedToUserId ?? null,
        dueDate: input.dueDate ?? null,
        sortOrder: maxSortOrder + 1000,
        customerVisible: input.customerVisible,
        createdByUserId: context.user!.id,
      },
      tx,
    );
    return { task, project };
  });

  await notifyTaskAssigned(task, project, organizationId);
  return task;
}

const updateTaskSchema = z.object({
  taskId: z.string().uuid(),
  milestoneId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  customerVisible: z.boolean().optional(),
});

export async function updateTask(rawInput: unknown): Promise<ProjectTask> {
  const input = parseOrThrow(updateTaskSchema, rawInput);
  const { tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  const { task, project, assigneeChanged } = await withTenantContext(tenantScope, async (tx) => {
    const existing = await projectTaskRepository.findById(input.taskId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Task");
    const project = await lockMutableProject(existing.projectId, organizationId, tx);

    if (input.milestoneId !== undefined && input.milestoneId !== null) {
      const milestone = await milestoneRepository.findById(input.milestoneId, tx);
      if (!milestone || milestone.projectId !== existing.projectId) throw new ValidationError("milestoneId does not belong to this project.");
    }
    if (input.assignedToUserId !== undefined && input.assignedToUserId !== null) await assertPlatformStaffMember(input.assignedToUserId, organizationId, tx);

    const { taskId, ...data } = input;
    const task = await projectTaskRepository.update(taskId, data, tx);
    const assigneeChanged = input.assignedToUserId !== undefined && input.assignedToUserId !== existing.assignedToUserId;
    return { task, project, assigneeChanged };
  });

  if (assigneeChanged) await notifyTaskAssigned(task, project, organizationId);
  return task;
}

/** Ordinary, non-terminal transitions (TODO/IN_PROGRESS/BLOCKED, including DONE -> one of these — the "reopen" path). `completeTask()`/`cancelTask()` own the two terminal edges, each with their own extra preconditions. */
const transitionTaskSchema = z.object({ taskId: z.string().uuid(), status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED"]) });

export async function transitionTask(rawInput: unknown): Promise<ProjectTask> {
  const input = parseOrThrow(transitionTaskSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  const { task, project, reopened } = await withTenantContext(tenantScope, async (tx) => {
    // Project lock taken BEFORE the task lock, consistently across every
    // function in this file — a fixed lock order (project, then task) is
    // what keeps `completeProject()`'s own project-row lock and these
    // child mutations from ever deadlocking against each other.
    const existingTask = await projectTaskRepository.findById(input.taskId, tx);
    if (!existingTask || existingTask.organizationId !== organizationId) throw new NotFoundError("Task");
    const project = await lockMutableProject(existingTask.projectId, organizationId, tx);
    const existing = await projectTaskRepository.findByIdLocked(input.taskId, tx);
    if (!existing) throw new NotFoundError("Task");
    if (!canTransitionTask(existing.status as ProjectTaskStatus, input.status as ProjectTaskStatus)) {
      throw new ValidationError(`Cannot transition a task from ${existing.status} to ${input.status}.`);
    }

    const reopened = existing.status === "DONE";
    const task = reopened ? await projectTaskRepository.reopen(input.taskId, input.status as "TODO" | "IN_PROGRESS", tx) : await projectTaskRepository.transitionStatus(input.taskId, [existing.status], input.status, tx);
    if (!task) throw new ConflictError("This task's status just changed. Reload and try again.");
    return { task, project, reopened };
  });

  if (reopened) {
    await audit
      .recordSuccess({
        action: "projects.task_reopened_after_completion",
        organizationId,
        resourceType: "project_task",
        resourceId: task.id,
        resourceName: task.title,
        metadata: { to: input.status },
        knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
      })
      .catch((error) => console.error("[audit] failed to record projects.task_reopened_after_completion", error));
  }
  if (task.status === "BLOCKED" && task.assignedToUserId) {
    await events.emit<ProjectTaskBlockedPayload>("projects.task_blocked", { taskId: task.id, projectId: project.id, organizationId, recipientUserId: task.assignedToUserId, projectTitle: project.title, taskTitle: task.title });
  }
  return task;
}

const taskIdSchema = z.object({ taskId: z.string().uuid() });

/**
 * Completion — gated by open dependencies (decision "Task completion
 * rules") AND, for a root task, by its own subtasks (Codex Security
 * Engineer finding H1: a root task could previously reach `DONE` — and
 * therefore satisfy `evaluateProjectCompletionCriteria()`'s own task
 * gate, since subtasks are deliberately excluded from that gate's own
 * denominator — while a real subtask underneath it was still open,
 * because nothing actually enforced the "an unfinished subtask blocks
 * its parent" invariant this file's own progress-model comment already
 * claimed). Deliberately NOT audited as its own action (see
 * project-management.md "Audit" — ordinary task completions are too
 * frequent/low-stakes to be a material audit event; only the reopen path
 * above is).
 */
export async function completeTask(rawInput: unknown): Promise<ProjectTask> {
  const input = parseOrThrow(taskIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existingTask = await projectTaskRepository.findById(input.taskId, tx);
    if (!existingTask || existingTask.organizationId !== organizationId) throw new NotFoundError("Task");
    await lockMutableProject(existingTask.projectId, organizationId, tx);
    const existing = await projectTaskRepository.findByIdLocked(input.taskId, tx);
    if (!existing) throw new NotFoundError("Task");
    if (!canTransitionTask(existing.status as ProjectTaskStatus, "DONE")) throw new ValidationError(`Cannot complete a task from ${existing.status}.`);

    if (existing.parentTaskId === null) {
      const subtasks = await projectTaskRepository.listSubtasks(existing.id, tx);
      const unfinishedSubtasks = subtasks.filter((s) => s.status !== "DONE" && s.status !== "CANCELLED");
      if (unfinishedSubtasks.length > 0) {
        throw new ValidationError(`This task cannot be completed yet — it has unfinished subtask(s): ${unfinishedSubtasks.map((s) => s.title).join(", ")}.`);
      }
    }

    const dependencies = await projectTaskDependencyRepository.listForTask(input.taskId, tx);
    if (dependencies.length > 0) {
      const prerequisiteIds = dependencies.map((d) => d.dependsOnTaskId);
      const prerequisites = await Promise.all(prerequisiteIds.map((id) => projectTaskRepository.findById(id, tx)));
      const unresolved = prerequisites.filter((p) => p && p.status !== "DONE" && p.status !== "CANCELLED");
      if (unresolved.length > 0) {
        throw new ValidationError(`This task cannot be completed yet — it depends on incomplete task(s): ${unresolved.map((p) => p!.title).join(", ")}.`);
      }
    }

    const updated = await projectTaskRepository.complete(input.taskId, [existing.status], context.user!.id, tx);
    if (!updated) throw new ConflictError("This task's status just changed. Reload and try again.");
    return updated;
  });
}

const cancelTaskSchema = z.object({ taskId: z.string().uuid(), reason: z.string().trim().min(1, "A reason is required.").max(1000) });

export async function cancelTask(rawInput: unknown): Promise<ProjectTask> {
  const input = parseOrThrow(cancelTaskSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existingTask = await projectTaskRepository.findById(input.taskId, tx);
    if (!existingTask || existingTask.organizationId !== organizationId) throw new NotFoundError("Task");
    await lockMutableProject(existingTask.projectId, organizationId, tx);
    const existing = await projectTaskRepository.findByIdLocked(input.taskId, tx);
    if (!existing) throw new NotFoundError("Task");
    if (!canTransitionTask(existing.status as ProjectTaskStatus, "CANCELLED")) throw new ValidationError(`Cannot cancel a task from ${existing.status}.`);
    const updated = await projectTaskRepository.cancel(input.taskId, [existing.status], { cancelledAt: new Date(), cancelledReason: input.reason, cancelledByUserId: context.user!.id }, tx);
    if (!updated) throw new ConflictError("This task's status just changed. Reload and try again.");
    return updated;
  });
}
