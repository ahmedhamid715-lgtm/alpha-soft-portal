"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";
import * as serviceDefinitionService from "@/server/services/service-definition-service";
import * as customerServiceService from "@/server/services/customer-service-service";
import type { ServiceDefinition, CustomerService } from "@/generated/prisma/client";

/**
 * Server actions for `/admin/services` (Build 29 — Roadmap Module 23).
 * Thin wrappers only — every mutation goes through the real domain
 * service, same `ActionResult`/`run()` shape every other admin actions
 * file in this codebase already uses.
 */
interface ActionResult<T> {
  data?: T;
  error?: string;
}

const REVALIDATE_PATHS = ["/admin/services"];

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    for (const path of REVALIDATE_PATHS) revalidatePath(path);
    return { data };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

// --- ServiceDefinition ---

export async function createServiceDefinitionAction(input: unknown): Promise<ActionResult<ServiceDefinition>> {
  return run(() => serviceDefinitionService.createServiceDefinition(input));
}

export async function updateServiceDefinitionAction(input: unknown): Promise<ActionResult<ServiceDefinition>> {
  return run(() => serviceDefinitionService.updateServiceDefinition(input));
}

export async function archiveServiceDefinitionAction(input: unknown): Promise<ActionResult<ServiceDefinition>> {
  return run(() => serviceDefinitionService.archiveServiceDefinition(input));
}

export async function reactivateServiceDefinitionAction(input: unknown): Promise<ActionResult<ServiceDefinition>> {
  return run(() => serviceDefinitionService.reactivateServiceDefinition(input));
}

// --- CustomerService ---

export async function provisionCustomerServiceAction(input: unknown): Promise<ActionResult<CustomerService>> {
  return run(() => customerServiceService.createCustomerServiceFromOnboardingServiceItem(input));
}

export async function createCustomerServiceManuallyAction(input: unknown): Promise<ActionResult<CustomerService>> {
  return run(() => customerServiceService.createCustomerServiceManually(input));
}

export async function updateCustomerServiceAction(input: unknown): Promise<ActionResult<CustomerService>> {
  return run(() => customerServiceService.updateCustomerService(input));
}

export async function setCustomerServiceOwnerAction(input: unknown): Promise<ActionResult<CustomerService>> {
  return run(() => customerServiceService.setCustomerServiceOwner(input));
}

export async function activateCustomerServiceAction(input: unknown): Promise<ActionResult<CustomerService>> {
  return run(() => customerServiceService.activateCustomerService(input));
}

export async function pauseCustomerServiceAction(input: unknown): Promise<ActionResult<CustomerService>> {
  return run(() => customerServiceService.pauseCustomerService(input));
}

export async function resumeCustomerServiceAction(input: unknown): Promise<ActionResult<CustomerService>> {
  return run(() => customerServiceService.resumeCustomerService(input));
}

export async function completeCustomerServiceAction(input: unknown): Promise<ActionResult<CustomerService>> {
  return run(() => customerServiceService.completeCustomerService(input));
}

export async function reopenCustomerServiceAction(input: unknown): Promise<ActionResult<CustomerService>> {
  return run(() => customerServiceService.reopenCustomerService(input));
}

export async function cancelCustomerServiceAction(input: unknown): Promise<ActionResult<CustomerService>> {
  return run(() => customerServiceService.cancelCustomerService(input));
}

// --- `/admin/services/new` and `/admin/services/customers/new` full-page
// create forms — `useActionState` (prevState, formData) shape, same
// convention `admin/tasks/new`/`admin/projects/new` already establish.

export interface ServiceFormState {
  error?: string;
}

function str(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

const createDefinitionFormSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(50),
  description: z.string().max(2000).optional(),
  category: z.enum(["SEO", "LOCAL_SEO", "WEB_DEVELOPMENT", "ECOMMERCE", "GHL_AUTOMATION", "CREATIVE", "OTHER"]),
  deliveryCadence: z.enum(["ONE_TIME", "RECURRING", "ONGOING"]),
});

export async function createServiceDefinitionFormAction(_prevState: ServiceFormState, formData: FormData): Promise<ServiceFormState> {
  const parsed = safeParseResult(createDefinitionFormSchema, {
    name: str(formData, "name"),
    code: str(formData, "code"),
    description: str(formData, "description"),
    category: str(formData, "category"),
    deliveryCadence: str(formData, "deliveryCadence"),
  });
  if (!parsed.success) return { error: "Invalid service definition." };

  let definitionId: string;
  try {
    const definition = await serviceDefinitionService.createServiceDefinition(parsed.data);
    definitionId = definition.id;
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath("/admin/services");
  redirect(`/admin/services/${definitionId}`);
}

const createManualFormSchema = z.object({
  customerOrganizationId: z.string().uuid(),
  companyId: z.string().uuid(),
  serviceDefinitionId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).default(1),
  ownerUserId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  targetEndDate: z.string().optional(),
});

const provisionFormSchema = z.object({
  sourceOnboardingServiceItemId: z.string().uuid(),
  serviceDefinitionId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).default(1),
  ownerUserId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  targetEndDate: z.string().optional(),
});

export async function createCustomerServiceFormAction(_prevState: ServiceFormState, formData: FormData): Promise<ServiceFormState> {
  const sourceOnboardingServiceItemId = str(formData, "sourceOnboardingServiceItemId");

  let customerServiceId: string;
  try {
    if (sourceOnboardingServiceItemId) {
      const parsed = safeParseResult(provisionFormSchema, {
        sourceOnboardingServiceItemId,
        serviceDefinitionId: str(formData, "serviceDefinitionId"),
        quantity: str(formData, "quantity"),
        ownerUserId: str(formData, "ownerUserId"),
        startDate: str(formData, "startDate"),
        targetEndDate: str(formData, "targetEndDate"),
      });
      if (!parsed.success) return { error: "Invalid customer service." };
      const created = await customerServiceService.createCustomerServiceFromOnboardingServiceItem(parsed.data);
      customerServiceId = created.id;
    } else {
      const parsed = safeParseResult(createManualFormSchema, {
        customerOrganizationId: str(formData, "customerOrganizationId"),
        companyId: str(formData, "companyId"),
        serviceDefinitionId: str(formData, "serviceDefinitionId"),
        quantity: str(formData, "quantity"),
        ownerUserId: str(formData, "ownerUserId"),
        startDate: str(formData, "startDate"),
        targetEndDate: str(formData, "targetEndDate"),
      });
      if (!parsed.success) return { error: "Invalid customer service." };
      const created = await customerServiceService.createCustomerServiceManually(parsed.data);
      customerServiceId = created.id;
    }
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath("/admin/services");
  redirect(`/admin/services/customers/${customerServiceId}`);
}
