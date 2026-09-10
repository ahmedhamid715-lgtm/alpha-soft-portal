import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveProjectScope } from "./project-shared";
import { projectTemplateRepository, projectTemplateMilestoneRepository, projectTemplateTaskRepository, projectTemplateQaCheckRepository, TEMPLATE_SORT_GAP } from "@/server/repositories/project-template-repository";
import { NotFoundError, ValidationError } from "@/lib/errors/app-error";
import type { ProjectTemplate, ProjectTemplateMilestone, ProjectTemplateTask, ProjectTemplateQaCheck } from "@/generated/prisma/client";

/**
 * Project Template CRUD (Build 27 — Roadmap Module 21). Editing a
 * template only ever affects the template's own rows — see
 * `project-service.ts`'s own `createProjectFromTemplate()` for the
 * SNAPSHOT boundary (a later edit here never rewrites an
 * already-instantiated project). `delivery_projects.manage` for every mutation,
 * `delivery_projects.read` for listing/viewing.
 */

const createTemplateSchema = z.object({ name: z.string().trim().min(1).max(200), description: z.string().trim().max(5000).nullable().optional() });

export async function createTemplate(rawInput: unknown): Promise<ProjectTemplate> {
  const input = parseOrThrow(createTemplateSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");
  return withTenantContext(tenantScope, (tx) => projectTemplateRepository.create({ id: generateId(), organizationId, name: input.name, description: input.description ?? null, createdByUserId: context.user!.id }, tx));
}

const listTemplatesSchema = z.object({ status: z.enum(["ACTIVE", "ARCHIVED"]).optional() });

export async function listTemplates(rawInput: unknown): Promise<ProjectTemplate[]> {
  const input = parseOrThrow(listTemplatesSchema, rawInput);
  const { tenantScope, organizationId } = await resolveProjectScope("delivery_projects.read");
  return withTenantContext(tenantScope, (tx) => projectTemplateRepository.listForOrganization(organizationId, input.status, tx));
}

export interface ProjectTemplateDetail {
  template: ProjectTemplate;
  milestones: ProjectTemplateMilestone[];
  tasks: ProjectTemplateTask[];
  qaChecks: ProjectTemplateQaCheck[];
}

const templateIdSchema = z.object({ templateId: z.string().uuid() });

export async function getTemplateDetail(rawInput: unknown): Promise<ProjectTemplateDetail> {
  const input = parseOrThrow(templateIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveProjectScope("delivery_projects.read");
  return withTenantContext(tenantScope, async (tx) => {
    const template = await projectTemplateRepository.findById(input.templateId, tx);
    if (!template || template.organizationId !== organizationId) throw new NotFoundError("Project template");
    const [milestones, tasks, qaChecks] = await Promise.all([
      projectTemplateMilestoneRepository.listForTemplate(input.templateId, tx),
      projectTemplateTaskRepository.listForTemplate(input.templateId, tx),
      projectTemplateQaCheckRepository.listForTemplate(input.templateId, tx),
    ]);
    return { template, milestones, tasks, qaChecks };
  });
}

const updateTemplateSchema = z.object({ templateId: z.string().uuid(), name: z.string().trim().min(1).max(200).optional(), description: z.string().trim().max(5000).nullable().optional() });

export async function updateTemplate(rawInput: unknown): Promise<ProjectTemplate> {
  const input = parseOrThrow(updateTemplateSchema, rawInput);
  const { tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");
  return withTenantContext(tenantScope, async (tx) => {
    const existing = await projectTemplateRepository.findById(input.templateId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Project template");
    const { templateId, ...data } = input;
    return projectTemplateRepository.update(templateId, data, tx);
  });
}

export async function archiveTemplate(rawInput: unknown): Promise<ProjectTemplate> {
  const input = parseOrThrow(templateIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");
  return withTenantContext(tenantScope, async (tx) => {
    const existing = await projectTemplateRepository.findById(input.templateId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Project template");
    const updated = await projectTemplateRepository.archive(input.templateId, tx);
    if (!updated) throw new ValidationError("This template is already archived.");
    return updated;
  });
}

export async function reactivateTemplate(rawInput: unknown): Promise<ProjectTemplate> {
  const input = parseOrThrow(templateIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");
  return withTenantContext(tenantScope, async (tx) => {
    const existing = await projectTemplateRepository.findById(input.templateId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Project template");
    const updated = await projectTemplateRepository.reactivate(input.templateId, tx);
    if (!updated) throw new ValidationError("This template is already active.");
    return updated;
  });
}

async function assertOwnedTemplate(templateId: string, organizationId: string, tx: Parameters<typeof projectTemplateRepository.findById>[1]): Promise<void> {
  const template = await projectTemplateRepository.findById(templateId, tx);
  if (!template || template.organizationId !== organizationId) throw new NotFoundError("Project template");
}

const addTemplateMilestoneSchema = z.object({
  templateId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  relativeDueDays: z.number().int().min(0).max(3650).nullable().optional(),
  customerVisible: z.boolean().default(false),
});

export async function addTemplateMilestone(rawInput: unknown): Promise<ProjectTemplateMilestone> {
  const input = parseOrThrow(addTemplateMilestoneSchema, rawInput);
  const { tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");
  return withTenantContext(tenantScope, async (tx) => {
    await assertOwnedTemplate(input.templateId, organizationId, tx);
    const existing = await projectTemplateMilestoneRepository.listForTemplate(input.templateId, tx);
    const maxSortOrder = existing.reduce((max, m) => Math.max(max, m.sortOrder), 0);
    return projectTemplateMilestoneRepository.create(
      { id: generateId(), organizationId, templateId: input.templateId, title: input.title, description: input.description ?? null, sortOrder: maxSortOrder + TEMPLATE_SORT_GAP, relativeDueDays: input.relativeDueDays ?? null, customerVisible: input.customerVisible },
      tx,
    );
  });
}

const addTemplateTaskSchema = z.object({
  templateId: z.string().uuid(),
  templateMilestoneId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  relativeDueDays: z.number().int().min(0).max(3650).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  customerVisible: z.boolean().default(false),
  defaultAssigneeRoleHint: z.string().trim().max(200).nullable().optional(),
});

export async function addTemplateTask(rawInput: unknown): Promise<ProjectTemplateTask> {
  const input = parseOrThrow(addTemplateTaskSchema, rawInput);
  const { tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");
  return withTenantContext(tenantScope, async (tx) => {
    await assertOwnedTemplate(input.templateId, organizationId, tx);
    if (input.templateMilestoneId) {
      const milestone = await projectTemplateMilestoneRepository.findById(input.templateMilestoneId, tx);
      if (!milestone || milestone.templateId !== input.templateId) throw new ValidationError("templateMilestoneId does not belong to this template.");
    }
    const existing = await projectTemplateTaskRepository.listForTemplate(input.templateId, tx);
    const maxSortOrder = existing.reduce((max, t) => Math.max(max, t.sortOrder), 0);
    return projectTemplateTaskRepository.create(
      {
        id: generateId(),
        organizationId,
        templateId: input.templateId,
        templateMilestoneId: input.templateMilestoneId ?? null,
        title: input.title,
        description: input.description ?? null,
        sortOrder: maxSortOrder + TEMPLATE_SORT_GAP,
        relativeDueDays: input.relativeDueDays ?? null,
        priority: input.priority,
        customerVisible: input.customerVisible,
        defaultAssigneeRoleHint: input.defaultAssigneeRoleHint ?? null,
      },
      tx,
    );
  });
}

const addTemplateQaCheckSchema = z.object({ templateId: z.string().uuid(), title: z.string().trim().min(1).max(200), required: z.boolean().default(true) });

export async function addTemplateQaCheck(rawInput: unknown): Promise<ProjectTemplateQaCheck> {
  const input = parseOrThrow(addTemplateQaCheckSchema, rawInput);
  const { tenantScope, organizationId } = await resolveProjectScope("delivery_projects.manage");
  return withTenantContext(tenantScope, async (tx) => {
    await assertOwnedTemplate(input.templateId, organizationId, tx);
    const existing = await projectTemplateQaCheckRepository.listForTemplate(input.templateId, tx);
    const maxSortOrder = existing.reduce((max, q) => Math.max(max, q.sortOrder), 0);
    return projectTemplateQaCheckRepository.create({ id: generateId(), organizationId, templateId: input.templateId, title: input.title, required: input.required, sortOrder: maxSortOrder + TEMPLATE_SORT_GAP }, tx);
  });
}
