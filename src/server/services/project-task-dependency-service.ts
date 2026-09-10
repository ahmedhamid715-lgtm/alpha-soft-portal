import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveProjectScope, lockMutableProject } from "./project-shared";
import { projectTaskRepository } from "@/server/repositories/project-task-repository";
import { projectTaskDependencyRepository } from "@/server/repositories/project-task-dependency-repository";
import { wouldCreateCycle } from "@/lib/projects/dependency-graph";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { ProjectTaskDependency } from "@/generated/prisma/client";

/**
 * Task dependency creation (Build 27 — Roadmap Module 21) — the one
 * write path that needs the project-level lock: `SELECT ... FOR UPDATE`
 * on the owning `Project` row serializes concurrent dependency mutations
 * for the SAME project, then every existing edge for that project is
 * loaded inside the SAME transaction and checked with `wouldCreateCycle()`
 * BEFORE the new edge is inserted. See
 * `src/lib/projects/dependency-graph.ts`'s own top comment for the full
 * reasoning on why full cycle prevention lives here and not in a DB
 * trigger. No deletion path exists in this build (no DELETE grant on
 * `project_task_dependencies` — see project-management.md "Known
 * limitations").
 */

const addDependencySchema = z.object({ taskId: z.string().uuid(), dependsOnTaskId: z.string().uuid() });

export async function addTaskDependency(rawInput: unknown): Promise<ProjectTaskDependency> {
  const input = parseOrThrow(addDependencySchema, rawInput);
  if (input.taskId === input.dependsOnTaskId) throw new ValidationError("A task cannot depend on itself.");
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const taskLookup = await projectTaskRepository.findById(input.taskId, tx);
    if (!taskLookup || taskLookup.organizationId !== organizationId) throw new NotFoundError("Task");

    // Locks the owning project row for the duration of the cycle check +
    // insert — this is the serialization point every concurrent
    // dependency mutation for this project goes through, and (Codex
    // Security Engineer finding H2/M3) the SAME lock `completeProject()`
    // and every other criteria-affecting child mutation in this file's
    // sibling services now take first, so a dependency insertion can
    // never interleave with a concurrent completion, task reopen, or
    // task-status change for the same project.
    const project = await lockMutableProject(taskLookup.projectId, organizationId, tx);

    const task = await projectTaskRepository.findById(input.taskId, tx);
    if (!task) throw new NotFoundError("Task");
    const dependsOnTask = await projectTaskRepository.findById(input.dependsOnTaskId, tx);
    if (!dependsOnTask || dependsOnTask.organizationId !== organizationId) throw new NotFoundError("Prerequisite task");
    if (dependsOnTask.projectId !== task.projectId) throw new ValidationError("A task can only depend on another task within the SAME project.");
    // Codex Security Engineer finding M3 — a dependency added AFTER its
    // own dependent task already reached DONE would leave that
    // already-completed task with an unresolved prerequisite, since
    // `completeTask()`'s own dependency gate only ever runs at the
    // moment of completion, never retroactively. Reopen the task first
    // if this dependency is genuinely needed.
    if (task.status === "DONE") throw new ValidationError("This task is already DONE — reopen it before adding a new dependency to it.");

    const existingEdges = await projectTaskDependencyRepository.listEdgesForProject(project.id, tx);
    if (existingEdges.some((e) => e.taskId === input.taskId && e.dependsOnTaskId === input.dependsOnTaskId)) {
      throw new ConflictError("This dependency already exists.");
    }
    if (wouldCreateCycle(existingEdges, { taskId: input.taskId, dependsOnTaskId: input.dependsOnTaskId })) {
      throw new ValidationError("This dependency would create a cycle — a task cannot (even transitively) depend on itself.");
    }

    return projectTaskDependencyRepository.create({ id: generateId(), organizationId, projectId: task.projectId, taskId: input.taskId, dependsOnTaskId: input.dependsOnTaskId, createdByUserId: context.user!.id }, tx);
  });
}
