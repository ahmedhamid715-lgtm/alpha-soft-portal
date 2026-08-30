"use server";

import { revalidatePath } from "next/cache";
import { toAppError } from "@/lib/errors/app-error";
import * as companyService from "@/server/services/crm-company-service";
import * as contactService from "@/server/services/crm-contact-service";
import * as leadService from "@/server/services/crm-lead-service";
import * as activityService from "@/server/services/crm-activity-service";
import * as taskService from "@/server/services/crm-task-service";
import * as leadSourceService from "@/server/services/crm-lead-source-service";
import * as customFieldService from "@/server/services/crm-custom-field-service";
import type { CrmCompany, CrmContact, CrmLead, CrmActivity, CrmTask, CrmLeadSource, CrmCustomFieldDefinition, CrmCustomFieldValue } from "@/generated/prisma/client";

/**
 * Every CRM mutation the UI needs, in one shared file (`/admin/crm/*`
 * sub-routes all import from here — same "one `actions.ts` per route
 * tree, not per leaf page" convention `admin/organizations/actions.ts`
 * already establishes for its own `[id]` child route). Each function is
 * a thin `service call -> revalidate -> typed {error}|{data} result`
 * wrapper — no business logic lives here; see the underlying
 * `crm-*-service.ts` for the real authorization/validation/persistence.
 */

interface ActionResult<T> {
  error?: string;
  data?: T;
}

async function run<T>(fn: () => Promise<T>, paths: string[]): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    for (const path of paths) revalidatePath(path);
    return { data };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

// --- Companies ---

export async function createCompanyAction(input: unknown): Promise<ActionResult<CrmCompany>> {
  return run(() => companyService.createCompany(input), ["/admin/crm/companies", "/admin/crm"]);
}

export async function updateCompanyAction(input: unknown): Promise<ActionResult<CrmCompany>> {
  const result = await run(() => companyService.updateCompany(input), ["/admin/crm/companies"]);
  if (result.data) revalidatePath(`/admin/crm/companies/${result.data.id}`);
  return result;
}

export async function archiveCompanyAction(input: unknown): Promise<ActionResult<CrmCompany>> {
  const result = await run(() => companyService.archiveCompany(input), ["/admin/crm/companies", "/admin/crm"]);
  if (result.data) revalidatePath(`/admin/crm/companies/${result.data.id}`);
  return result;
}

export async function reactivateCompanyAction(input: unknown): Promise<ActionResult<CrmCompany>> {
  const result = await run(() => companyService.reactivateCompany(input), ["/admin/crm/companies"]);
  if (result.data) revalidatePath(`/admin/crm/companies/${result.data.id}`);
  return result;
}

// --- Contacts ---

export async function createContactAction(input: unknown): Promise<ActionResult<CrmContact>> {
  const result = await run(() => contactService.createContact(input), ["/admin/crm/contacts", "/admin/crm"]);
  if (result.data) revalidatePath(`/admin/crm/companies/${result.data.companyId}`);
  return result;
}

export async function updateContactAction(input: unknown): Promise<ActionResult<CrmContact>> {
  const result = await run(() => contactService.updateContact(input), ["/admin/crm/contacts"]);
  if (result.data) revalidatePath(`/admin/crm/contacts/${result.data.id}`);
  return result;
}

export async function archiveContactAction(input: unknown): Promise<ActionResult<CrmContact>> {
  const result = await run(() => contactService.archiveContact(input), ["/admin/crm/contacts"]);
  if (result.data) revalidatePath(`/admin/crm/contacts/${result.data.id}`);
  return result;
}

export async function reactivateContactAction(input: unknown): Promise<ActionResult<CrmContact>> {
  const result = await run(() => contactService.reactivateContact(input), ["/admin/crm/contacts"]);
  if (result.data) revalidatePath(`/admin/crm/contacts/${result.data.id}`);
  return result;
}

// --- Leads ---

export async function createLeadAction(input: unknown): Promise<ActionResult<CrmLead>> {
  return run(() => leadService.createLead(input), ["/admin/crm/leads", "/admin/crm"]);
}

export async function updateLeadAction(input: unknown): Promise<ActionResult<CrmLead>> {
  const result = await run(() => leadService.updateLead(input), ["/admin/crm/leads"]);
  if (result.data) revalidatePath(`/admin/crm/leads/${result.data.id}`);
  return result;
}

export async function changeLeadStatusAction(input: unknown): Promise<ActionResult<CrmLead>> {
  const result = await run(() => leadService.changeLeadStatus(input), ["/admin/crm/leads", "/admin/crm"]);
  if (result.data) revalidatePath(`/admin/crm/leads/${result.data.id}`);
  return result;
}

// --- Activities ---

export async function logActivityAction(input: unknown): Promise<ActionResult<CrmActivity>> {
  const result = await run(() => activityService.logActivity(input), []);
  if (result.data) {
    if (result.data.leadId) revalidatePath(`/admin/crm/leads/${result.data.leadId}`);
    if (result.data.companyId) revalidatePath(`/admin/crm/companies/${result.data.companyId}`);
    if (result.data.contactId) revalidatePath(`/admin/crm/contacts/${result.data.contactId}`);
  }
  return result;
}

// --- Tasks ---

export async function createTaskAction(input: unknown): Promise<ActionResult<CrmTask>> {
  return run(() => taskService.createTask(input), ["/admin/crm/tasks", "/admin/crm"]);
}

export async function updateTaskAction(input: unknown): Promise<ActionResult<CrmTask>> {
  return run(() => taskService.updateTask(input), ["/admin/crm/tasks"]);
}

export async function completeTaskAction(input: unknown): Promise<ActionResult<CrmTask>> {
  return run(() => taskService.completeTask(input), ["/admin/crm/tasks", "/admin/crm"]);
}

export async function cancelTaskAction(input: unknown): Promise<ActionResult<CrmTask>> {
  return run(() => taskService.cancelTask(input), ["/admin/crm/tasks", "/admin/crm"]);
}

// --- Lead sources ---

export async function createLeadSourceAction(input: unknown): Promise<ActionResult<CrmLeadSource>> {
  return run(() => leadSourceService.createLeadSource(input), ["/admin/crm/settings"]);
}

export async function updateLeadSourceAction(input: unknown): Promise<ActionResult<CrmLeadSource>> {
  return run(() => leadSourceService.updateLeadSource(input), ["/admin/crm/settings"]);
}

// --- Custom fields ---

export async function createCustomFieldDefinitionAction(input: unknown): Promise<ActionResult<CrmCustomFieldDefinition>> {
  return run(() => customFieldService.createCustomFieldDefinition(input), ["/admin/crm/settings"]);
}

export async function updateCustomFieldDefinitionAction(input: unknown): Promise<ActionResult<CrmCustomFieldDefinition>> {
  return run(() => customFieldService.updateCustomFieldDefinition(input), ["/admin/crm/settings"]);
}

export async function setCustomFieldValueAction(input: unknown): Promise<ActionResult<CrmCustomFieldValue>> {
  const result = await run(() => customFieldService.setCustomFieldValue(input), []);
  if (result.data) {
    if (result.data.leadId) revalidatePath(`/admin/crm/leads/${result.data.leadId}`);
    if (result.data.companyId) revalidatePath(`/admin/crm/companies/${result.data.companyId}`);
    if (result.data.contactId) revalidatePath(`/admin/crm/contacts/${result.data.contactId}`);
  }
  return result;
}
