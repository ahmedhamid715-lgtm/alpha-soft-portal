"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createTemplate, updateTemplate, archiveTemplate, reactivateTemplate, addTemplateMilestone, addTemplateTask, addTemplateQaCheck } from "@/server/services/project-template-service";
import { createProjectFromTemplate } from "@/server/services/project-service";
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

function redirectTo(path: string): never {
  redirect(path);
}

const createTemplateSchema = z.object({ name: z.string().min(1).max(200), description: z.string().max(5000).optional() });

export async function createTemplateAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(createTemplateSchema, { name: str(formData, "name"), description: str(formData, "description") });
  if (!parsed.success) return { error: "Invalid template." };

  let templateId: string;
  try {
    const template = await createTemplate(parsed.data);
    templateId = template.id;
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath("/admin/projects/templates");
  redirectTo(`/admin/projects/templates/${templateId}`);
}

const templateFieldsSchema = z.object({ templateId: z.string().uuid(), name: z.string().min(1).max(200).optional(), description: z.string().max(5000).optional() });

export async function updateTemplateAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(templateFieldsSchema, { templateId: str(formData, "templateId"), name: str(formData, "name"), description: str(formData, "description") });
  if (!parsed.success) return { error: "Invalid template." };
  try {
    await updateTemplate(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/templates/${parsed.data.templateId}`);
  return { success: true };
}

const templateIdSchema = z.object({ templateId: z.string().uuid() });

export async function archiveTemplateAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(templateIdSchema, { templateId: str(formData, "templateId") });
  if (!parsed.success) return { error: "Invalid template." };
  try {
    await archiveTemplate(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/templates/${parsed.data.templateId}`);
  revalidatePath("/admin/projects/templates");
  return { success: true };
}

export async function reactivateTemplateAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(templateIdSchema, { templateId: str(formData, "templateId") });
  if (!parsed.success) return { error: "Invalid template." };
  try {
    await reactivateTemplate(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/templates/${parsed.data.templateId}`);
  revalidatePath("/admin/projects/templates");
  return { success: true };
}

const addMilestoneSchema = z.object({ templateId: z.string().uuid(), title: z.string().min(1).max(200), description: z.string().max(5000).optional(), relativeDueDays: z.string().optional(), customerVisible: z.string().optional() });

export async function addTemplateMilestoneAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(addMilestoneSchema, {
    templateId: str(formData, "templateId"),
    title: str(formData, "title"),
    description: str(formData, "description"),
    relativeDueDays: str(formData, "relativeDueDays"),
    customerVisible: str(formData, "customerVisible"),
  });
  if (!parsed.success) return { error: "Invalid milestone." };
  try {
    await addTemplateMilestone({
      templateId: parsed.data.templateId,
      title: parsed.data.title,
      description: parsed.data.description,
      relativeDueDays: parsed.data.relativeDueDays ? Number(parsed.data.relativeDueDays) : undefined,
      customerVisible: parsed.data.customerVisible === "on",
    });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/templates/${parsed.data.templateId}`);
  return { success: true };
}

const addTaskSchema = z.object({
  templateId: z.string().uuid(),
  templateMilestoneId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  relativeDueDays: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  customerVisible: z.string().optional(),
  defaultAssigneeRoleHint: z.string().max(200).optional(),
});

export async function addTemplateTaskAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(addTaskSchema, {
    templateId: str(formData, "templateId"),
    templateMilestoneId: str(formData, "templateMilestoneId"),
    title: str(formData, "title"),
    description: str(formData, "description"),
    relativeDueDays: str(formData, "relativeDueDays"),
    priority: str(formData, "priority"),
    customerVisible: str(formData, "customerVisible"),
    defaultAssigneeRoleHint: str(formData, "defaultAssigneeRoleHint"),
  });
  if (!parsed.success) return { error: "Invalid task." };
  try {
    await addTemplateTask({
      templateId: parsed.data.templateId,
      templateMilestoneId: parsed.data.templateMilestoneId,
      title: parsed.data.title,
      description: parsed.data.description,
      relativeDueDays: parsed.data.relativeDueDays ? Number(parsed.data.relativeDueDays) : undefined,
      priority: parsed.data.priority,
      customerVisible: parsed.data.customerVisible === "on",
      defaultAssigneeRoleHint: parsed.data.defaultAssigneeRoleHint,
    });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/templates/${parsed.data.templateId}`);
  return { success: true };
}

const addQaCheckSchema = z.object({ templateId: z.string().uuid(), title: z.string().min(1).max(200), required: z.string().optional() });

export async function addTemplateQaCheckAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(addQaCheckSchema, { templateId: str(formData, "templateId"), title: str(formData, "title"), required: str(formData, "required") });
  if (!parsed.success) return { error: "Invalid QA check." };
  try {
    await addTemplateQaCheck({ templateId: parsed.data.templateId, title: parsed.data.title, required: parsed.data.required !== "off" });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/projects/templates/${parsed.data.templateId}`);
  return { success: true };
}

const instantiateSchema = z.object({
  templateId: z.string().uuid(),
  customerOrganizationId: z.string().uuid(),
  companyId: z.string().uuid(),
  title: z.string().max(200).optional(),
  startDate: z.string().optional(),
  ownerUserId: z.string().uuid().optional(),
});

export async function instantiateFromTemplateAction(_prevState: ProjectActionState, formData: FormData): Promise<ProjectActionState> {
  const parsed = safeParseResult(instantiateSchema, {
    templateId: str(formData, "templateId"),
    customerOrganizationId: str(formData, "customerOrganizationId"),
    companyId: str(formData, "companyId"),
    title: str(formData, "title"),
    startDate: str(formData, "startDate"),
    ownerUserId: str(formData, "ownerUserId"),
  });
  if (!parsed.success) return { error: "Invalid instantiation request." };

  let projectId: string;
  try {
    const project = await createProjectFromTemplate(parsed.data);
    projectId = project.id;
  } catch (error) {
    return { error: toAppError(error).message };
  }
  redirectTo(`/admin/projects/${projectId}`);
}
