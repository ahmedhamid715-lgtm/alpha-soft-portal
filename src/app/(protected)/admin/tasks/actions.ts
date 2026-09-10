"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";
import * as globalTaskService from "@/server/services/tasks/global-task-service";
import * as internalTaskService from "@/server/services/tasks/internal-task-service";
import type { InternalTask } from "@/generated/prisma/client";

/**
 * Server actions for `/admin/tasks` (Build 28 — Roadmap Module 22). Thin
 * wrappers only — every mutation still goes through `global-task-service`,
 * which re-dispatches to each source's OWN authoritative service (never a
 * shortcut mutation path here). Same `ActionResult`/`run()` shape every
 * other admin actions file in this codebase already uses (see
 * `admin/crm/actions.ts`, `admin/projects/actions.ts`).
 */
interface ActionResult<T> {
  data?: T;
  error?: string;
}

const REVALIDATE_PATHS = ["/admin/tasks"];

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    for (const path of REVALIDATE_PATHS) revalidatePath(path);
    return { data };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

export async function completeGlobalTaskAction(input: unknown): Promise<ActionResult<void>> {
  return run(() => globalTaskService.completeGlobalTask(input));
}

export async function reopenGlobalTaskAction(input: unknown): Promise<ActionResult<void>> {
  return run(() => globalTaskService.reopenGlobalTask(input));
}

export async function cancelGlobalTaskAction(input: unknown): Promise<ActionResult<void>> {
  return run(() => globalTaskService.cancelGlobalTask(input));
}

export async function assignGlobalTaskAction(input: unknown): Promise<ActionResult<void>> {
  return run(() => globalTaskService.assignGlobalTask(input));
}

export async function changeGlobalTaskDueDateAction(input: unknown): Promise<ActionResult<void>> {
  return run(() => globalTaskService.changeGlobalTaskDueDate(input));
}

export async function createInternalTaskAction(input: unknown): Promise<ActionResult<InternalTask>> {
  return run(() => internalTaskService.createInternalTask(input));
}

export async function updateInternalTaskAction(input: unknown): Promise<ActionResult<InternalTask>> {
  return run(() => internalTaskService.updateInternalTask(input));
}

export async function completeInternalTaskAction(input: unknown): Promise<ActionResult<InternalTask>> {
  return run(() => internalTaskService.completeInternalTask(input));
}

export async function reopenInternalTaskAction(input: unknown): Promise<ActionResult<InternalTask>> {
  return run(() => internalTaskService.reopenInternalTask(input));
}

export async function cancelInternalTaskAction(input: unknown): Promise<ActionResult<InternalTask>> {
  return run(() => internalTaskService.cancelInternalTask(input));
}

// --- `/admin/tasks/new` full-page create form — `useActionState`
// (prevState, formData) shape, same convention as `admin/projects/new`.

export interface InternalTaskFormState {
  error?: string;
}

function str(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

const createInternalTaskFormSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  assignedToUserId: z.string().uuid().optional(),
  dueAt: z.string().optional(),
});

export async function createInternalTaskFormAction(_prevState: InternalTaskFormState, formData: FormData): Promise<InternalTaskFormState> {
  const parsed = safeParseResult(createInternalTaskFormSchema, {
    title: str(formData, "title"),
    description: str(formData, "description"),
    priority: str(formData, "priority"),
    assignedToUserId: str(formData, "assignedToUserId"),
    dueAt: str(formData, "dueAt"),
  });
  if (!parsed.success) return { error: "Invalid task." };

  let taskId: string;
  try {
    const task = await internalTaskService.createInternalTask({ ...parsed.data, dueAt: parsed.data.dueAt ? `${parsed.data.dueAt}T00:00:00.000Z` : undefined });
    taskId = task.id;
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath("/admin/tasks");
  redirect(`/admin/tasks/${taskId}`);
}
