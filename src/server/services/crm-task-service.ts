import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope, assertPlatformStaffMember } from "./crm-shared";
import { crmTaskRepository, type CrmTaskListFilters } from "@/server/repositories/crm-task-repository";
import { crmLeadRepository } from "@/server/repositories/crm-lead-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { crmContactRepository } from "@/server/repositories/crm-contact-repository";
import { events } from "@/lib/platform/events";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors/app-error";
import { type OffsetPaginationParams, type OffsetPaginatedResult } from "@/lib/platform/pagination";
import type { CrmTask } from "@/generated/prisma/client";

/**
 * CRM-scoped tasks/follow-ups — `crm.manage` for mutations, `crm.read`
 * for listing. This is Roadmap 13's own bounded CRM task list ("a
 * follow-up call is due on this lead"), never the global cross-module
 * Task Management engine (Roadmap 22) — see crm-architecture.md "CRM
 * task boundary." Not separately audited (routine sales-rep bookkeeping,
 * not a governance-significant event — see `audit/catalog.ts`'s own CRM
 * comment); task ASSIGNMENT does emit `crm.task.assigned` for the one
 * justified notification (see `lib/notifications/subscribers.ts`).
 */

interface CrmTaskAssignedPayload {
  taskId: string;
  organizationId: string;
  assignedToUserId: string;
  title: string;
}

const parentSchema = z
  .object({ leadId: z.string().uuid().optional(), companyId: z.string().uuid().optional(), contactId: z.string().uuid().optional() })
  .refine((v) => [v.leadId, v.companyId, v.contactId].filter(Boolean).length === 1, { message: "Exactly one of leadId, companyId, or contactId is required." });

const createTaskSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    dueAt: z.coerce.date().nullable().optional(),
    assignedToUserId: z.string().uuid().nullable().optional(),
  })
  .and(parentSchema);

export async function createTask(rawInput: unknown): Promise<CrmTask> {
  const input = parseOrThrow(createTaskSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  const task = await withTenantContext(tenantScope, async (tx) => {
    await assertParentBelongsToOrganization(input, organizationId, tx);
    if (input.assignedToUserId) {
      await assertPlatformStaffMember(input.assignedToUserId, organizationId, tx);
    }

    return crmTaskRepository.create(
      {
        id: generateId(),
        organizationId,
        leadId: input.leadId ?? null,
        companyId: input.companyId ?? null,
        contactId: input.contactId ?? null,
        title: input.title,
        description: input.description ?? null,
        dueAt: input.dueAt ?? null,
        assignedToUserId: input.assignedToUserId ?? null,
        createdByUserId: context.user!.id,
      },
      tx,
    );
  });

  if (task.assignedToUserId) await emitTaskAssigned(task);
  return task;
}

async function emitTaskAssigned(task: CrmTask): Promise<void> {
  await events.emit<CrmTaskAssignedPayload>("crm.task.assigned", { taskId: task.id, organizationId: task.organizationId, assignedToUserId: task.assignedToUserId!, title: task.title });
}

async function assertParentBelongsToOrganization(
  input: { leadId?: string; companyId?: string; contactId?: string },
  organizationId: string,
  tx: Parameters<typeof crmLeadRepository.findById>[1],
): Promise<void> {
  if (input.leadId) {
    const lead = await crmLeadRepository.findById(input.leadId, tx);
    if (!lead || lead.organizationId !== organizationId) throw new ValidationError("leadId does not reference a valid lead.");
  } else if (input.companyId) {
    const company = await crmCompanyRepository.findById(input.companyId, tx);
    if (!company || company.organizationId !== organizationId) throw new ValidationError("companyId does not reference a valid company.");
  } else if (input.contactId) {
    const contact = await crmContactRepository.findById(input.contactId, tx);
    if (!contact || contact.organizationId !== organizationId) throw new ValidationError("contactId does not reference a valid contact.");
  }
}

const listTasksSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["OPEN", "COMPLETED", "CANCELLED"]).optional(),
  assignedToUserId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
});

export async function listTasks(rawInput: unknown): Promise<OffsetPaginatedResult<CrmTask>> {
  const input = parseOrThrow(listTasksSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };
  const filters: CrmTaskListFilters = { status: input.status, assignedToUserId: input.assignedToUserId, leadId: input.leadId, companyId: input.companyId, contactId: input.contactId };

  return withTenantContext(tenantScope, (tx) => crmTaskRepository.listForOrganization(organizationId, params, filters, tx));
}

const updateTaskSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
});

export async function updateTask(rawInput: unknown): Promise<CrmTask> {
  const input = parseOrThrow(updateTaskSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  const { task, assignmentChanged } = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmTaskRepository.findById(input.taskId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Task");
    if (input.assignedToUserId) {
      await assertPlatformStaffMember(input.assignedToUserId, organizationId, tx);
    }

    const { taskId, ...data } = input;
    const updated = await crmTaskRepository.update(taskId, data, tx);
    return { task: updated, assignmentChanged: "assignedToUserId" in input && input.assignedToUserId !== existing.assignedToUserId };
  });

  if (assignmentChanged && task.assignedToUserId) await emitTaskAssigned(task);
  return task;
}

const completeTaskSchema = z.object({ taskId: z.string().uuid() });

export async function completeTask(rawInput: unknown): Promise<CrmTask> {
  const input = parseOrThrow(completeTaskSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmTaskRepository.findById(input.taskId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Task");
    if (existing.status !== "OPEN") throw new ValidationError("Only an open task can be completed.");
    const completed = await crmTaskRepository.complete(input.taskId, tx);
    if (!completed) throw new ConflictError("This task was just changed by someone else. Reload and try again.");
    return completed;
  });
}

const cancelTaskSchema = z.object({ taskId: z.string().uuid() });

export async function cancelTask(rawInput: unknown): Promise<CrmTask> {
  const input = parseOrThrow(cancelTaskSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmTaskRepository.findById(input.taskId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Task");
    if (existing.status !== "OPEN") throw new ValidationError("Only an open task can be cancelled.");
    const cancelled = await crmTaskRepository.cancel(input.taskId, tx);
    if (!cancelled) throw new ConflictError("This task was just changed by someone else. Reload and try again.");
    return cancelled;
  });
}
