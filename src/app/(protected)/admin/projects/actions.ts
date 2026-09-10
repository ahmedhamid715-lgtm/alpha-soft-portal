"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createProject,
  createProjectFromOnboarding,
  updateProject,
  transitionProject,
  reopenProject,
  cancelProject,
  archiveProject,
  completeProject,
  completeProjectOverride,
} from "@/server/services/project-service";
import { createMilestone, cancelMilestone } from "@/server/services/project-milestone-service";
import { createTask, updateTask, transitionTask, completeTask, cancelTask } from "@/server/services/project-task-service";
import { addTaskDependency } from "@/server/services/project-task-dependency-service";
import { addComment } from "@/server/services/project-comment-service";
import { addAttachment } from "@/server/services/project-attachment-service";
import { requestApproval, decideApproval } from "@/server/services/project-approval-service";
import { createQaCheck, recordQaCheck } from "@/server/services/project-qa-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

export interface ProjectActionState {
  error?: string;
  success?: boolean;
}

function str(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// --- Project ---------------------------------------------------------------

const createProjectSchema = z.object({
  customerOrganizationId: z.string().uuid(),
  companyId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  ownerUserId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  targetEndDate: z.string().optional(),
});

export async function createProjectAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(createProjectSchema, {
    customerOrganizationId: str(formData, "customerOrganizationId"),
    companyId: str(formData, "companyId"),
    title: str(formData, "title"),
    description: str(formData, "description"),
    priority: str(formData, "priority"),
    ownerUserId: str(formData, "ownerUserId"),
    startDate: str(formData, "startDate"),
    targetEndDate: str(formData, "targetEndDate"),
  });
  if (!parsed.success) return { error: "Invalid project." };

  let projectId: string;
  try {
    const project = await createProject(parsed.data);
    projectId = project.id;
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath("/admin/projects");
  redirectTo(`/admin/projects/${projectId}`);
}

const createFromOnboardingSchema = z.object({
  onboardingId: z.string().uuid(),
  sourceServiceItemId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  ownerUserId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  targetEndDate: z.string().optional(),
});

export async function createProjectFromOnboardingAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(createFromOnboardingSchema, {
    onboardingId: str(formData, "onboardingId"),
    sourceServiceItemId: str(formData, "sourceServiceItemId"),
    title: str(formData, "title"),
    description: str(formData, "description"),
    priority: str(formData, "priority"),
    ownerUserId: str(formData, "ownerUserId"),
    startDate: str(formData, "startDate"),
    targetEndDate: str(formData, "targetEndDate"),
  });
  if (!parsed.success) return { error: "Invalid project." };

  let projectId: string;
  try {
    const project = await createProjectFromOnboarding(parsed.data);
    projectId = project.id;
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath("/admin/projects");
  redirectTo(`/admin/projects/${projectId}`);
}

const updateProjectSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  ownerUserId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  targetEndDate: z.string().optional(),
});

export async function updateProjectAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(updateProjectSchema, {
    projectId: str(formData, "projectId"),
    title: str(formData, "title"),
    description: str(formData, "description"),
    priority: str(formData, "priority"),
    ownerUserId: str(formData, "ownerUserId"),
    startDate: str(formData, "startDate"),
    targetEndDate: str(formData, "targetEndDate"),
  });
  if (!parsed.success) return { error: "Invalid project." };

  try {
    await updateProject(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

const transitionSchema = z.object({ projectId: z.string().uuid(), status: z.enum(["PLANNED", "ACTIVE", "ON_HOLD"]) });

export async function transitionProjectAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(transitionSchema, { projectId: str(formData, "projectId"), status: str(formData, "status") });
  if (!parsed.success) return { error: "Invalid transition." };
  try {
    await transitionProject(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

const projectIdSchema = z.object({ projectId: z.string().uuid() });

export async function reopenProjectAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(projectIdSchema, { projectId: str(formData, "projectId") });
  if (!parsed.success) return { error: "Invalid project." };
  try {
    await reopenProject(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

const reasonSchema = z.object({ projectId: z.string().uuid(), reason: z.string().min(1).max(1000) });

export async function cancelProjectAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(reasonSchema, { projectId: str(formData, "projectId"), reason: str(formData, "reason") });
  if (!parsed.success) return { error: "A reason is required." };
  try {
    await cancelProject(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

export async function archiveProjectAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(projectIdSchema, { projectId: str(formData, "projectId") });
  if (!parsed.success) return { error: "Invalid project." };
  try {
    await archiveProject(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

export async function completeProjectAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(projectIdSchema, { projectId: str(formData, "projectId") });
  if (!parsed.success) return { error: "Invalid project." };
  try {
    await completeProject(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

export async function completeProjectOverrideAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(reasonSchema, { projectId: str(formData, "projectId"), reason: str(formData, "reason") });
  if (!parsed.success) return { error: "A reason is required." };
  try {
    await completeProjectOverride(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

// --- Milestones --------------------------------------------------------

const createMilestoneSchema = z.object({ projectId: z.string().uuid(), title: z.string().min(1).max(200), description: z.string().max(5000).optional(), targetDate: z.string().optional(), customerVisible: z.string().optional() });

export async function createMilestoneAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(createMilestoneSchema, {
    projectId: str(formData, "projectId"),
    title: str(formData, "title"),
    description: str(formData, "description"),
    targetDate: str(formData, "targetDate"),
    customerVisible: str(formData, "customerVisible"),
  });
  if (!parsed.success) return { error: "Invalid milestone." };
  try {
    await createMilestone({ ...parsed.data, customerVisible: parsed.data.customerVisible === "on" });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

const cancelMilestoneSchema = z.object({ milestoneId: z.string().uuid(), projectId: z.string().uuid(), reason: z.string().min(1).max(1000) });

export async function cancelMilestoneAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(cancelMilestoneSchema, { milestoneId: str(formData, "milestoneId"), projectId: str(formData, "projectId"), reason: str(formData, "reason") });
  if (!parsed.success) return { error: "A reason is required." };
  try {
    await cancelMilestone({ milestoneId: parsed.data.milestoneId, reason: parsed.data.reason });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

// --- Tasks ---------------------------------------------------------------

const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  milestoneId: z.string().uuid().optional(),
  parentTaskId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  assignedToUserId: z.string().uuid().optional(),
  dueDate: z.string().optional(),
  customerVisible: z.string().optional(),
});

export async function createTaskAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(createTaskSchema, {
    projectId: str(formData, "projectId"),
    milestoneId: str(formData, "milestoneId"),
    parentTaskId: str(formData, "parentTaskId"),
    title: str(formData, "title"),
    description: str(formData, "description"),
    priority: str(formData, "priority"),
    assignedToUserId: str(formData, "assignedToUserId"),
    dueDate: str(formData, "dueDate"),
    customerVisible: str(formData, "customerVisible"),
  });
  if (!parsed.success) return { error: "Invalid task." };
  try {
    await createTask({ ...parsed.data, customerVisible: parsed.data.customerVisible === "on" });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

const updateTaskSchema = z.object({
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  assignedToUserId: z.string().uuid().optional(),
  dueDate: z.string().optional(),
});

export async function updateTaskAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(updateTaskSchema, { taskId: str(formData, "taskId"), projectId: str(formData, "projectId"), assignedToUserId: str(formData, "assignedToUserId"), dueDate: str(formData, "dueDate") });
  if (!parsed.success) return { error: "Invalid task." };
  try {
    await updateTask({ taskId: parsed.data.taskId, assignedToUserId: parsed.data.assignedToUserId, dueDate: parsed.data.dueDate });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

const transitionTaskSchema = z.object({ taskId: z.string().uuid(), projectId: z.string().uuid(), status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED"]) });

export async function transitionTaskAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(transitionTaskSchema, { taskId: str(formData, "taskId"), projectId: str(formData, "projectId"), status: str(formData, "status") });
  if (!parsed.success) return { error: "Invalid transition." };
  try {
    await transitionTask({ taskId: parsed.data.taskId, status: parsed.data.status });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

const taskIdSchema = z.object({ taskId: z.string().uuid(), projectId: z.string().uuid() });

export async function completeTaskAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(taskIdSchema, { taskId: str(formData, "taskId"), projectId: str(formData, "projectId") });
  if (!parsed.success) return { error: "Invalid task." };
  try {
    await completeTask({ taskId: parsed.data.taskId });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

const cancelTaskSchema = z.object({ taskId: z.string().uuid(), projectId: z.string().uuid(), reason: z.string().min(1).max(1000) });

export async function cancelTaskAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(cancelTaskSchema, { taskId: str(formData, "taskId"), projectId: str(formData, "projectId"), reason: str(formData, "reason") });
  if (!parsed.success) return { error: "A reason is required." };
  try {
    await cancelTask({ taskId: parsed.data.taskId, reason: parsed.data.reason });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

const addDependencySchema = z.object({ taskId: z.string().uuid(), dependsOnTaskId: z.string().uuid(), projectId: z.string().uuid() });

export async function addTaskDependencyAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(addDependencySchema, { taskId: str(formData, "taskId"), dependsOnTaskId: str(formData, "dependsOnTaskId"), projectId: str(formData, "projectId") });
  if (!parsed.success) return { error: "Invalid dependency." };
  try {
    await addTaskDependency({ taskId: parsed.data.taskId, dependsOnTaskId: parsed.data.dependsOnTaskId });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

// --- Comments / attachments -----------------------------------------------

const addCommentSchema = z.object({ projectId: z.string().uuid(), taskId: z.string().uuid().optional(), body: z.string().min(1).max(5000), visibility: z.enum(["INTERNAL", "CUSTOMER_VISIBLE"]).optional() });

export async function addCommentAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(addCommentSchema, { projectId: str(formData, "projectId"), taskId: str(formData, "taskId"), body: str(formData, "body"), visibility: str(formData, "visibility") });
  if (!parsed.success) return { error: "A comment body is required." };
  try {
    await addComment(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

const addAttachmentSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  externalUrl: z.string().max(2000).optional(),
  visibility: z.enum(["INTERNAL", "CUSTOMER_VISIBLE"]).optional(),
});

export async function addAttachmentAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(addAttachmentSchema, {
    projectId: str(formData, "projectId"),
    taskId: str(formData, "taskId"),
    title: str(formData, "title"),
    description: str(formData, "description"),
    externalUrl: str(formData, "externalUrl"),
    visibility: str(formData, "visibility"),
  });
  if (!parsed.success) return { error: "Invalid attachment." };
  try {
    await addAttachment(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

// --- Approvals -------------------------------------------------------------

const requestApprovalSchema = z.object({ projectId: z.string().uuid(), resourceType: z.enum(["PROJECT", "MILESTONE"]), resourceId: z.string().uuid() });

export async function requestApprovalAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(requestApprovalSchema, { projectId: str(formData, "projectId"), resourceType: str(formData, "resourceType"), resourceId: str(formData, "resourceId") });
  if (!parsed.success) return { error: "Invalid approval request." };
  try {
    await requestApproval(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

const decideApprovalSchema = z.object({ approvalId: z.string().uuid(), projectId: z.string().uuid(), decision: z.enum(["APPROVED", "REJECTED"]), reason: z.string().max(1000).optional() });

export async function decideApprovalAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(decideApprovalSchema, { approvalId: str(formData, "approvalId"), projectId: str(formData, "projectId"), decision: str(formData, "decision"), reason: str(formData, "reason") });
  if (!parsed.success) return { error: "Invalid decision." };
  try {
    await decideApproval({ approvalId: parsed.data.approvalId, decision: parsed.data.decision, reason: parsed.data.reason });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

// --- QA ----------------------------------------------------------------

const createQaCheckSchema = z.object({ projectId: z.string().uuid(), taskId: z.string().uuid().optional(), milestoneId: z.string().uuid().optional(), title: z.string().min(1).max(200), required: z.string().optional() });

export async function createQaCheckAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(createQaCheckSchema, {
    projectId: str(formData, "projectId"),
    taskId: str(formData, "taskId"),
    milestoneId: str(formData, "milestoneId"),
    title: str(formData, "title"),
    required: str(formData, "required"),
  });
  if (!parsed.success) return { error: "Invalid QA check." };
  try {
    await createQaCheck({ ...parsed.data, required: parsed.data.required !== "off" });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

const recordQaCheckSchema = z.object({ qaCheckId: z.string().uuid(), projectId: z.string().uuid(), status: z.enum(["PASSED", "FAILED", "WAIVED"]), notes: z.string().max(2000).optional() });

export async function recordQaCheckAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(recordQaCheckSchema, { qaCheckId: str(formData, "qaCheckId"), projectId: str(formData, "projectId"), status: str(formData, "status"), notes: str(formData, "notes") });
  if (!parsed.success) return { error: "Invalid QA outcome." };
  try {
    await recordQaCheck({ qaCheckId: parsed.data.qaCheckId, status: parsed.data.status, notes: parsed.data.notes });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/${parsed.data.projectId}`);
  return { success: true };
}

// `redirect()` throws internally (Next.js's own control-flow signal) —
// this helper is `never`-typed so both call sites above stay honest that
// no `ProjectActionState` is actually returned on the success path.
function redirectTo(path: string): never {
  redirect(path);
}
