import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveDeliveryServiceScope } from "./delivery-service-shared";
import { assertPlatformStaffMember } from "./crm-shared";
import { canTransitionCustomerService } from "@/lib/services/lifecycle";
import { customerServiceRepository, type CustomerServiceListFilters } from "@/server/repositories/customer-service-repository";
import { serviceDefinitionRepository } from "@/server/repositories/service-definition-repository";
import { crmClientOnboardingServiceItemRepository } from "@/server/repositories/crm-client-onboarding-service-item-repository";
import { crmClientOnboardingRepository } from "@/server/repositories/crm-client-onboarding-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { projectRepository } from "@/server/repositories/project-repository";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { CustomerService, CustomerServiceStatus, ServiceCategory, ProjectStatus } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";
import type { OffsetPaginatedResult, OffsetPaginationParams } from "@/lib/platform/pagination";

/**
 * `CustomerService` provisioning/lifecycle (Build 29 — Roadmap Module
 * 23) — one real operational service engagement for one real customer.
 * `delivery_services.manage` for every mutation; `delivery_services.read`
 * for listing. See docs/architecture/service-management.md for the
 * full architecture writeup.
 */

interface CustomerServiceLifecycleEventPayload {
  customerServiceId: string;
  organizationId: string;
  ownerUserId: string;
  serviceName: string;
  companyName: string;
}

type LifecycleAuditAction =
  | "services.customer_service_provisioned"
  | "services.customer_service_created_manually"
  | "services.customer_service_owner_changed"
  | "services.customer_service_activated"
  | "services.customer_service_paused"
  | "services.customer_service_resumed"
  | "services.customer_service_completed"
  | "services.customer_service_cancelled";

async function auditCustomerService(context: AuthorizationContext, action: LifecycleAuditAction, organizationId: string, customerService: CustomerService, resourceName: string, metadata?: Record<string, unknown>): Promise<void> {
  await audit
    .recordSuccess({ action, organizationId, resourceType: "customer_service", resourceId: customerService.id, resourceName, metadata, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error(`[audit] failed to record ${action}`, error));
}

async function notifyLifecycleEvent(
  eventType: "services.customer_service_owner_assigned" | "services.customer_service_activated" | "services.customer_service_completed",
  customerService: CustomerService,
  serviceName: string,
  companyName: string,
): Promise<void> {
  // No owner = no recipient — never emit a notification with no real target.
  if (!customerService.ownerUserId) return;
  await events.emit<CustomerServiceLifecycleEventPayload>(eventType, {
    customerServiceId: customerService.id,
    organizationId: customerService.organizationId,
    ownerUserId: customerService.ownerUserId,
    serviceName,
    companyName,
  });
}

/** Validates `companyId` is a real, platform-owned `CrmCompany` already converted to EXACTLY `customerOrganizationId` — the same structural check `project-service.ts`'s own module-private `resolveConsistentCompany()` performs (re-implemented here rather than imported — a small, stable, ~10-line check, judged cheaper than a new cross-domain coupling; see service-management.md "Manual customer service creation"). Never creates a company/organization as a side effect. */
async function resolveConsistentCompany(companyId: string, customerOrganizationId: string, platformOrganizationId: string, tx: TransactionClient) {
  const company = await crmCompanyRepository.findById(companyId, tx);
  if (!company || company.organizationId !== platformOrganizationId) throw new NotFoundError("Company");
  if (company.convertedToOrganizationId !== customerOrganizationId) {
    throw new ValidationError("companyId does not match customerOrganizationId — the company must already be converted to exactly this customer organization.");
  }
  return company;
}

async function assertActiveCustomerOrganization(customerOrganizationId: string, tx: TransactionClient) {
  const org = await organizationRepository.findById(customerOrganizationId, tx);
  if (!org || org.status !== "ACTIVE") throw new ValidationError("customerOrganizationId does not reference an active organization.");
  if (org.isPlatform) throw new ValidationError("customerOrganizationId must be a real customer organization, not the platform organization.");
  return org;
}

async function assertActiveServiceDefinition(serviceDefinitionId: string, organizationId: string, tx: TransactionClient) {
  const definition = await serviceDefinitionRepository.findById(serviceDefinitionId, tx);
  if (!definition || definition.organizationId !== organizationId) throw new NotFoundError("Service definition");
  if (definition.status !== "ACTIVE") throw new ValidationError("This service definition is archived and cannot be used for a new engagement.");
  return definition;
}

// --- Provisioning (from an onboarding service item) -----------------------

const provisionSchema = z.object({
  sourceOnboardingServiceItemId: z.string().uuid(),
  serviceDefinitionId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).default(1),
  ownerUserId: z.string().uuid().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  targetEndDate: z.coerce.date().nullable().optional(),
});

/**
 * The one controlled operation for the onboarding → canonical service
 * handoff. Idempotent — a repeat call for the same source item returns
 * the EXISTING engagement rather than erroring or duplicating (the real
 * guarantee is the DB-level partial unique index; this read-side check
 * makes the common case return cleanly rather than racing the
 * constraint into a translated `ConflictError`).
 */
export async function createCustomerServiceFromOnboardingServiceItem(rawInput: unknown): Promise<CustomerService> {
  const input = parseOrThrow(provisionSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.manage");

  const result = await withTenantContext(tenantScope, async (tx) => {
    const serviceItem = await crmClientOnboardingServiceItemRepository.findById(input.sourceOnboardingServiceItemId, tx);
    if (!serviceItem || serviceItem.organizationId !== organizationId) throw new NotFoundError("Onboarding service item");

    const onboarding = await crmClientOnboardingRepository.findById(serviceItem.onboardingId, tx);
    if (!onboarding || onboarding.organizationId !== organizationId) throw new NotFoundError("Onboarding");

    const existing = await customerServiceRepository.findActiveForSourceItem(input.sourceOnboardingServiceItemId, tx);
    if (existing) {
      const definition = await serviceDefinitionRepository.findById(existing.serviceDefinitionId, tx);
      const company = await crmCompanyRepository.findById(existing.companyId, tx);
      return { customerService: existing, wasCreated: false, serviceName: definition?.name ?? "Service", companyName: company?.name ?? "Customer" };
    }

    const definition = await assertActiveServiceDefinition(input.serviceDefinitionId, organizationId, tx);
    const company = await crmCompanyRepository.findById(onboarding.companyId, tx);
    if (!company) throw new NotFoundError("Company");
    if (input.ownerUserId) await assertPlatformStaffMember(input.ownerUserId, organizationId, tx);

    const created = await customerServiceRepository.create(
      {
        id: generateId(),
        organizationId,
        customerOrganizationId: onboarding.linkedOrganizationId,
        companyId: onboarding.companyId,
        serviceDefinitionId: input.serviceDefinitionId,
        sourceOnboardingServiceItemId: input.sourceOnboardingServiceItemId,
        quantity: input.quantity,
        ownerUserId: input.ownerUserId ?? null,
        startDate: input.startDate ?? null,
        targetEndDate: input.targetEndDate ?? null,
        createdByUserId: context.user!.id,
      },
      tx,
    );
    return { customerService: created, wasCreated: true, serviceName: definition.name, companyName: company.name };
  });

  if (result.wasCreated) {
    await auditCustomerService(context, "services.customer_service_provisioned", organizationId, result.customerService, result.serviceName, { sourceOnboardingServiceItemId: input.sourceOnboardingServiceItemId });
    if (result.customerService.ownerUserId) {
      await auditCustomerService(context, "services.customer_service_owner_changed", organizationId, result.customerService, result.serviceName, { ownerUserId: result.customerService.ownerUserId });
      await notifyLifecycleEvent("services.customer_service_owner_assigned", result.customerService, result.serviceName, result.companyName);
    }
  }
  return result.customerService;
}

// --- Manual creation --------------------------------------------------------

const createManualSchema = z.object({
  customerOrganizationId: z.string().uuid(),
  companyId: z.string().uuid(),
  serviceDefinitionId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).default(1),
  ownerUserId: z.string().uuid().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  targetEndDate: z.coerce.date().nullable().optional(),
});

/** No proposal/onboarding provenance — `sourceOnboardingServiceItemId` stays honestly `null`. Never fabricates sales history. */
export async function createCustomerServiceManually(rawInput: unknown): Promise<CustomerService> {
  const input = parseOrThrow(createManualSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.manage");

  const { customerService, serviceName, companyName } = await withTenantContext(tenantScope, async (tx) => {
    await assertActiveCustomerOrganization(input.customerOrganizationId, tx);
    const company = await resolveConsistentCompany(input.companyId, input.customerOrganizationId, organizationId, tx);
    const definition = await assertActiveServiceDefinition(input.serviceDefinitionId, organizationId, tx);
    if (input.ownerUserId) await assertPlatformStaffMember(input.ownerUserId, organizationId, tx);

    const created = await customerServiceRepository.create(
      {
        id: generateId(),
        organizationId,
        customerOrganizationId: input.customerOrganizationId,
        companyId: input.companyId,
        serviceDefinitionId: input.serviceDefinitionId,
        sourceOnboardingServiceItemId: null,
        quantity: input.quantity,
        ownerUserId: input.ownerUserId ?? null,
        startDate: input.startDate ?? null,
        targetEndDate: input.targetEndDate ?? null,
        createdByUserId: context.user!.id,
      },
      tx,
    );
    return { customerService: created, serviceName: definition.name, companyName: company.name };
  });

  await auditCustomerService(context, "services.customer_service_created_manually", organizationId, customerService, serviceName);
  if (customerService.ownerUserId) {
    await auditCustomerService(context, "services.customer_service_owner_changed", organizationId, customerService, serviceName, { ownerUserId: customerService.ownerUserId });
    await notifyLifecycleEvent("services.customer_service_owner_assigned", customerService, serviceName, companyName);
  }
  return customerService;
}

// --- Read ---------------------------------------------------------------

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["PENDING", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]).optional(),
  customerOrganizationId: z.string().uuid().optional(),
  serviceDefinitionId: z.string().uuid().optional(),
  ownerUserId: z.string().uuid().optional(),
  search: z.string().trim().max(200).optional(),
});

export async function listCustomerServices(rawInput: unknown = {}): Promise<OffsetPaginatedResult<CustomerService>> {
  const input = parseOrThrow(listSchema, rawInput);
  const { tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.read");
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };
  const filters: CustomerServiceListFilters = { status: input.status as CustomerServiceStatus | undefined, customerOrganizationId: input.customerOrganizationId, serviceDefinitionId: input.serviceDefinitionId, ownerUserId: input.ownerUserId, search: input.search };
  return withTenantContext(tenantScope, (tx) => customerServiceRepository.listForOrganization(organizationId, params, filters, tx));
}

export interface CustomerServiceListItem extends CustomerService {
  serviceName: string;
  category: ServiceCategory;
  companyName: string;
  ownerName: string | null;
}

/**
 * The `/admin/services` list page's own display-enriched read — a
 * bounded batch resolve keyed off ONLY the distinct ids on the current
 * PAGE (never the full result set), the same discipline
 * `global-task-service.ts`'s own `resolveDisplayContext()` (Build 28)
 * already establishes. Never a per-row query.
 */
export async function listCustomerServicesForAdmin(rawInput: unknown = {}): Promise<OffsetPaginatedResult<CustomerServiceListItem>> {
  const page = await listCustomerServices(rawInput);
  if (page.items.length === 0) return { items: [], pageInfo: page.pageInfo };

  const { tenantScope } = await resolveDeliveryServiceScope("delivery_services.read");
  const items = await withTenantContext(tenantScope, async (tx) => {
    const definitionIds = [...new Set(page.items.map((cs) => cs.serviceDefinitionId))];
    const companyIds = [...new Set(page.items.map((cs) => cs.companyId))];
    const ownerIds = [...new Set(page.items.map((cs) => cs.ownerUserId).filter((id): id is string => id !== null))];

    const [definitions, companies, owners] = await Promise.all([
      tx.serviceDefinition.findMany({ where: { id: { in: definitionIds } }, select: { id: true, name: true, category: true } }),
      tx.crmCompany.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }),
      ownerIds.length > 0 ? tx.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    const definitionById = new Map(definitions.map((d) => [d.id, d]));
    const companyById = new Map(companies.map((c) => [c.id, c.name]));
    const ownerNameById = new Map(owners.map((o) => [o.id, o.name]));

    return page.items.map((cs) => ({
      ...cs,
      serviceName: definitionById.get(cs.serviceDefinitionId)?.name ?? "Service",
      category: definitionById.get(cs.serviceDefinitionId)?.category ?? ("OTHER" as ServiceCategory),
      companyName: companyById.get(cs.companyId) ?? "Customer",
      ownerName: cs.ownerUserId ? (ownerNameById.get(cs.ownerUserId) ?? null) : null,
    }));
  });
  return { items, pageInfo: page.pageInfo };
}

const idSchema = z.object({ customerServiceId: z.string().uuid() });

export async function getCustomerService(rawInput: unknown): Promise<CustomerService> {
  const input = parseOrThrow(idSchema, rawInput);
  const { tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.read");
  const customerService = await withTenantContext(tenantScope, (tx) => customerServiceRepository.findById(input.customerServiceId, tx));
  if (!customerService || customerService.organizationId !== organizationId) throw new NotFoundError("Customer service");
  return customerService;
}

export interface CustomerServiceDetail extends CustomerService {
  serviceName: string;
  category: ServiceCategory;
  companyName: string;
  customerOrganizationName: string;
  ownerName: string | null;
  /** `false` when the caller lacks `crm.onboarding.read` — see "Authorization intersection" below; distinguishes "not authorized to see" from "genuinely has no provenance" (manual creation). */
  canSeeProvenance: boolean;
  sourceOnboardingServiceItemTitle: string | null;
  sourceOnboardingId: string | null;
  /** `false` when the caller lacks `delivery_projects.read`. */
  canSeeLinkedProjects: boolean;
  linkedProjects: { id: string; title: string; status: ProjectStatus }[];
}

/**
 * The `/admin/services/customers/[id]` detail page's own enriched read
 * — one bounded batch, never a per-row query.
 *
 * **Authorization intersection** (Build 29 Codex Security Engineer
 * finding SM-SEC-01): `delivery_services.read` alone only grants
 * visibility into THIS module's own two tables (definition/company/
 * owner display names, all already bounded/customer-safe). Onboarding
 * provenance (the source item's title, which belongs to Build 23's own
 * domain) and linked-project data (Build 27's own domain) are each
 * gated behind that source's OWN read permission too — the same
 * "aggregator must never widen what a caller could already see"
 * discipline Task Management's `authorizedSourceTypes()` (Build 28)
 * already establishes for an analogous cross-domain read.
 */
export async function getCustomerServiceDetail(rawInput: unknown): Promise<CustomerServiceDetail> {
  const customerService = await getCustomerService(rawInput);
  const { context, tenantScope } = await resolveDeliveryServiceScope("delivery_services.read");
  const canSeeProvenance = context.permissions.has("crm.onboarding.read");
  const canSeeLinkedProjects = context.permissions.has("delivery_projects.read");

  return withTenantContext(tenantScope, async (tx) => {
    const [definition, company, customerOrganization, owner, sourceItem, linkedProjects] = await Promise.all([
      tx.serviceDefinition.findUnique({ where: { id: customerService.serviceDefinitionId }, select: { name: true, category: true } }),
      tx.crmCompany.findUnique({ where: { id: customerService.companyId }, select: { name: true } }),
      tx.organization.findUnique({ where: { id: customerService.customerOrganizationId }, select: { displayName: true } }),
      customerService.ownerUserId ? tx.user.findUnique({ where: { id: customerService.ownerUserId }, select: { name: true } }) : Promise.resolve(null),
      canSeeProvenance && customerService.sourceOnboardingServiceItemId ? tx.crmClientOnboardingServiceItem.findUnique({ where: { id: customerService.sourceOnboardingServiceItemId }, select: { title: true, onboardingId: true } }) : Promise.resolve(null),
      canSeeLinkedProjects ? projectRepository.listForCustomerService(customerService.id, tx) : Promise.resolve([]),
    ]);

    return {
      ...customerService,
      serviceName: definition?.name ?? "Service",
      category: definition?.category ?? ("OTHER" as ServiceCategory),
      companyName: company?.name ?? "Customer",
      customerOrganizationName: customerOrganization?.displayName ?? "Customer",
      ownerName: owner?.name ?? null,
      canSeeProvenance,
      sourceOnboardingServiceItemTitle: sourceItem?.title ?? null,
      sourceOnboardingId: sourceItem?.onboardingId ?? null,
      canSeeLinkedProjects,
      linkedProjects: linkedProjects.map((p) => ({ id: p.id, title: p.title, status: p.status })),
    };
  });
}

/** Every unmapped onboarding service item — see service-management.md "Unmapped historical services." */
/**
 * Build 29 Codex Security Engineer finding SM-SEC-01 — this function's
 * whole content IS onboarding-domain data (item title/description,
 * customer name), so `delivery_services.read` alone is not sufficient
 * authority to see it; the caller must independently hold
 * `crm.onboarding.read` too (the authorization-intersection discipline
 * Task Management's own `authorizedSourceTypes()` already establishes
 * for an analogous cross-domain read). Throws, rather than silently
 * returning `[]`, so the caller (the Unmapped tab) can render an honest
 * denial state instead of an empty-looking-like-"nothing unmapped" list.
 */
export async function listUnprovisionedOnboardingServiceItems() {
  const { context, tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.read");
  if (!context.permissions.has("crm.onboarding.read")) throw new ValidationError("Viewing unmapped onboarding service items also requires the crm.onboarding.read permission.");
  return withTenantContext(tenantScope, (tx) => crmClientOnboardingServiceItemRepository.listUnprovisioned(organizationId, tx));
}

// --- Owner ------------------------------------------------------------------

const setOwnerSchema = z.object({ customerServiceId: z.string().uuid(), ownerUserId: z.string().uuid().nullable() });

export async function setCustomerServiceOwner(rawInput: unknown): Promise<CustomerService> {
  const input = parseOrThrow(setOwnerSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.manage");

  const { customerService, serviceName, companyName, changed } = await withTenantContext(tenantScope, async (tx) => {
    const existing = await customerServiceRepository.findById(input.customerServiceId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Customer service");
    if (input.ownerUserId) await assertPlatformStaffMember(input.ownerUserId, organizationId, tx);
    const changed = existing.ownerUserId !== input.ownerUserId;
    const updated = await customerServiceRepository.update(input.customerServiceId, { ownerUserId: input.ownerUserId }, tx);
    const definition = await serviceDefinitionRepository.findById(updated.serviceDefinitionId, tx);
    const company = await crmCompanyRepository.findById(updated.companyId, tx);
    return { customerService: updated, serviceName: definition?.name ?? "Service", companyName: company?.name ?? "Customer", changed };
  });

  if (changed) {
    await auditCustomerService(context, "services.customer_service_owner_changed", organizationId, customerService, serviceName, { ownerUserId: customerService.ownerUserId });
    await notifyLifecycleEvent("services.customer_service_owner_assigned", customerService, serviceName, companyName);
  }
  return customerService;
}

// --- Editable operational fields --------------------------------------------

const updateSchema = z.object({
  customerServiceId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).optional(),
  startDate: z.coerce.date().nullable().optional(),
  targetEndDate: z.coerce.date().nullable().optional(),
});

export async function updateCustomerService(rawInput: unknown): Promise<CustomerService> {
  const input = parseOrThrow(updateSchema, rawInput);
  const { tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await customerServiceRepository.findById(input.customerServiceId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Customer service");
    if (input.startDate !== undefined && input.targetEndDate !== undefined && input.startDate && input.targetEndDate && input.targetEndDate < input.startDate) {
      throw new ValidationError("targetEndDate cannot be before startDate.");
    }
    const { customerServiceId, ...data } = input;
    return customerServiceRepository.update(customerServiceId, data, tx);
  });
}

// --- Lifecycle ----------------------------------------------------------

async function loadDisplayContext(customerService: CustomerService, tx: TransactionClient): Promise<{ serviceName: string; companyName: string }> {
  const definition = await serviceDefinitionRepository.findById(customerService.serviceDefinitionId, tx);
  const company = await crmCompanyRepository.findById(customerService.companyId, tx);
  return { serviceName: definition?.name ?? "Service", companyName: company?.name ?? "Customer" };
}

async function guardTransition(customerServiceId: string, organizationId: string, to: CustomerServiceStatus, tx: TransactionClient): Promise<CustomerService> {
  const existing = await customerServiceRepository.findByIdLocked(customerServiceId, tx);
  if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Customer service");
  if (!canTransitionCustomerService(existing.status, to)) throw new ValidationError(`Cannot move a ${existing.status} service to ${to}.`);
  return existing;
}

export async function activateCustomerService(rawInput: unknown): Promise<CustomerService> {
  const input = parseOrThrow(idSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.manage");

  const { customerService, serviceName, companyName } = await withTenantContext(tenantScope, async (tx) => {
    await guardTransition(input.customerServiceId, organizationId, "ACTIVE", tx);
    const updated = await customerServiceRepository.activate(input.customerServiceId, tx);
    if (!updated) throw new ConflictError("This service was just changed by someone else. Reload and try again.");
    const display = await loadDisplayContext(updated, tx);
    return { customerService: updated, ...display };
  });

  await auditCustomerService(context, "services.customer_service_activated", organizationId, customerService, serviceName);
  await notifyLifecycleEvent("services.customer_service_activated", customerService, serviceName, companyName);
  return customerService;
}

export async function pauseCustomerService(rawInput: unknown): Promise<CustomerService> {
  const input = parseOrThrow(idSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.manage");

  const { customerService, serviceName } = await withTenantContext(tenantScope, async (tx) => {
    await guardTransition(input.customerServiceId, organizationId, "PAUSED", tx);
    const updated = await customerServiceRepository.pause(input.customerServiceId, tx);
    if (!updated) throw new ConflictError("This service was just changed by someone else. Reload and try again.");
    const display = await loadDisplayContext(updated, tx);
    return { customerService: updated, ...display };
  });

  await auditCustomerService(context, "services.customer_service_paused", organizationId, customerService, serviceName);
  return customerService;
}

export async function resumeCustomerService(rawInput: unknown): Promise<CustomerService> {
  const input = parseOrThrow(idSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.manage");

  const { customerService, serviceName } = await withTenantContext(tenantScope, async (tx) => {
    await guardTransition(input.customerServiceId, organizationId, "ACTIVE", tx);
    const updated = await customerServiceRepository.resume(input.customerServiceId, tx);
    if (!updated) throw new ConflictError("This service was just changed by someone else. Reload and try again.");
    const display = await loadDisplayContext(updated, tx);
    return { customerService: updated, ...display };
  });

  await auditCustomerService(context, "services.customer_service_resumed", organizationId, customerService, serviceName);
  return customerService;
}

export async function completeCustomerService(rawInput: unknown): Promise<CustomerService> {
  const input = parseOrThrow(idSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.manage");

  const { customerService, serviceName, companyName } = await withTenantContext(tenantScope, async (tx) => {
    await guardTransition(input.customerServiceId, organizationId, "COMPLETED", tx);
    const updated = await customerServiceRepository.complete(input.customerServiceId, tx);
    if (!updated) throw new ConflictError("This service was just changed by someone else. Reload and try again.");
    const display = await loadDisplayContext(updated, tx);
    return { customerService: updated, ...display };
  });

  await auditCustomerService(context, "services.customer_service_completed", organizationId, customerService, serviceName);
  await notifyLifecycleEvent("services.customer_service_completed", customerService, serviceName, companyName);
  return customerService;
}

export async function reopenCustomerService(rawInput: unknown): Promise<CustomerService> {
  const input = parseOrThrow(idSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.manage");

  const { customerService, serviceName } = await withTenantContext(tenantScope, async (tx) => {
    await guardTransition(input.customerServiceId, organizationId, "ACTIVE", tx);
    const updated = await customerServiceRepository.reopen(input.customerServiceId, tx);
    if (!updated) throw new ConflictError("This service was just changed by someone else. Reload and try again.");
    const display = await loadDisplayContext(updated, tx);
    return { customerService: updated, ...display };
  });

  await auditCustomerService(context, "services.customer_service_activated", organizationId, customerService, serviceName, { reopened: true });
  return customerService;
}

const cancelSchema = z.object({ customerServiceId: z.string().uuid(), reason: z.string().trim().min(1, "A reason is required.").max(1000) });

export async function cancelCustomerService(rawInput: unknown): Promise<CustomerService> {
  const input = parseOrThrow(cancelSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.manage");

  const { customerService, serviceName } = await withTenantContext(tenantScope, async (tx) => {
    await guardTransition(input.customerServiceId, organizationId, "CANCELLED", tx);
    const updated = await customerServiceRepository.cancel(input.customerServiceId, { cancelledReason: input.reason, cancelledByUserId: context.user!.id }, tx);
    if (!updated) throw new ConflictError("This service was just changed by someone else. Reload and try again.");
    const display = await loadDisplayContext(updated, tx);
    return { customerService: updated, ...display };
  });

  await auditCustomerService(context, "services.customer_service_cancelled", organizationId, customerService, serviceName, { reason: input.reason });
  return customerService;
}

// --- Cross-module composition -----------------------------------------

export interface Customer360ServiceSummary {
  id: string;
  serviceName: string;
  category: ServiceCategory;
  status: CustomerServiceStatus;
  ownerName: string | null;
  startDate: Date | null;
  targetEndDate: Date | null;
  /** `false` when the caller lacks `delivery_projects.read` — see "Authorization intersection" below. */
  canSeeLinkedProjects: boolean;
  linkedProjectTitles: string[];
}

/**
 * Customer 360's own canonical services tier (Build 24 integration —
 * see service-management.md "Customer 360 integration"). Customer 360
 * NEVER queries `customer_services`/`service_definitions` directly —
 * this is the one function it calls, matching every other section's
 * own "composition layer owns no persistence of its own" discipline.
 * Bounded to one company's own engagements (`listForCompany()`'s own
 * 50-row cap) — ONE batched query (never one query per service — see
 * `projectRepository.listForCustomerServices()`'s own Codex Performance
 * Engineer finding writeup) resolves owner names/project titles for the
 * page's own display needs.
 *
 * **Authorization intersection** (Build 29 Codex Security Engineer
 * finding SM-SEC-01, same fix as `getCustomerServiceDetail()`): linked
 * project titles are Build 27's own domain data, gated behind
 * `delivery_projects.read` independently of `delivery_services.read`.
 */
export async function listServicesForCustomer360(companyId: string): Promise<Customer360ServiceSummary[]> {
  const { context, tenantScope } = await resolveDeliveryServiceScope("delivery_services.read");
  const canSeeLinkedProjects = context.permissions.has("delivery_projects.read");

  return withTenantContext(tenantScope, async (tx) => {
    const customerServices = await customerServiceRepository.listForCompany(companyId, tx);
    if (customerServices.length === 0) return [];

    const definitionIds = [...new Set(customerServices.map((cs) => cs.serviceDefinitionId))];
    const ownerIds = [...new Set(customerServices.map((cs) => cs.ownerUserId).filter((id): id is string => id !== null))];
    const customerServiceIds = customerServices.map((cs) => cs.id);

    const [definitions, owners, linkedProjects] = await Promise.all([
      tx.serviceDefinition.findMany({ where: { id: { in: definitionIds } }, select: { id: true, name: true, category: true } }),
      ownerIds.length > 0 ? tx.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      canSeeLinkedProjects ? projectRepository.listForCustomerServices(customerServiceIds, tx) : Promise.resolve([]),
    ]);

    const definitionById = new Map(definitions.map((d) => [d.id, d]));
    const ownerNameById = new Map(owners.map((o) => [o.id, o.name]));
    const projectTitlesByServiceId = new Map<string, string[]>();
    for (const project of linkedProjects) {
      if (!project.customerServiceId) continue;
      const titles = projectTitlesByServiceId.get(project.customerServiceId) ?? [];
      titles.push(project.title);
      projectTitlesByServiceId.set(project.customerServiceId, titles);
    }

    return customerServices.map((cs) => {
      const definition = definitionById.get(cs.serviceDefinitionId);
      return {
        id: cs.id,
        serviceName: definition?.name ?? "Service",
        category: definition?.category ?? ("OTHER" as ServiceCategory),
        status: cs.status,
        ownerName: cs.ownerUserId ? (ownerNameById.get(cs.ownerUserId) ?? null) : null,
        startDate: cs.startDate,
        targetEndDate: cs.targetEndDate,
        canSeeLinkedProjects,
        linkedProjectTitles: projectTitlesByServiceId.get(cs.id) ?? [],
      };
    });
  });
}

