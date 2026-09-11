import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveDeliveryServiceScope } from "./delivery-service-shared";
import { serviceDefinitionRepository, type ServiceDefinitionListFilters } from "@/server/repositories/service-definition-repository";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ConflictError } from "@/lib/errors/app-error";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { ServiceDefinition, ServiceCategory, ServiceDeliveryCadence, ServiceDefinitionStatus } from "@/generated/prisma/client";

/**
 * `ServiceDefinition` catalog CRUD (Build 29 — Roadmap Module 23) — the
 * platform's own service catalog. `delivery_services.catalog_manage`
 * for every mutation (a SEPARATE, narrower authority from
 * `delivery_services.manage` — see permissions.ts's own doc comment);
 * `delivery_services.read` for listing.
 */

async function auditDefinition(
  context: AuthorizationContext,
  action: "services.definition_created" | "services.definition_updated" | "services.definition_archived" | "services.definition_reactivated",
  organizationId: string,
  definition: ServiceDefinition,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await audit
    .recordSuccess({ action, organizationId, resourceType: "service_definition", resourceId: definition.id, resourceName: definition.name, metadata, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error(`[audit] failed to record ${action}`, error));
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(50),
  description: z.string().trim().max(2000).nullable().optional(),
  category: z.enum(["SEO", "LOCAL_SEO", "WEB_DEVELOPMENT", "ECOMMERCE", "GHL_AUTOMATION", "CREATIVE", "OTHER"]),
  deliveryCadence: z.enum(["ONE_TIME", "RECURRING", "ONGOING"]),
  sortOrder: z.coerce.number().int().default(0),
});

export async function createServiceDefinition(rawInput: unknown): Promise<ServiceDefinition> {
  const input = parseOrThrow(createSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.catalog_manage");

  const definition = await withTenantContext(tenantScope, async (tx) => {
    const existing = await serviceDefinitionRepository.findByCode(organizationId, input.code, tx);
    if (existing) throw new ConflictError(`A service definition with code "${input.code}" already exists.`);
    return serviceDefinitionRepository.create(
      { id: generateId(), organizationId, name: input.name, code: input.code, description: input.description ?? null, category: input.category as ServiceCategory, deliveryCadence: input.deliveryCadence as ServiceDeliveryCadence, sortOrder: input.sortOrder },
      tx,
    );
  });

  await auditDefinition(context, "services.definition_created", organizationId, definition);
  return definition;
}

const listSchema = z.object({
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  category: z.enum(["SEO", "LOCAL_SEO", "WEB_DEVELOPMENT", "ECOMMERCE", "GHL_AUTOMATION", "CREATIVE", "OTHER"]).optional(),
  search: z.string().trim().max(200).optional(),
});

export async function listServiceDefinitions(rawInput: unknown = {}): Promise<ServiceDefinition[]> {
  const input = parseOrThrow(listSchema, rawInput);
  const { tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.read");
  const filters: ServiceDefinitionListFilters = { status: input.status as ServiceDefinitionStatus | undefined, category: input.category as ServiceCategory | undefined, search: input.search };
  return withTenantContext(tenantScope, (tx) => serviceDefinitionRepository.listAll(organizationId, filters, tx));
}

/** Every `ACTIVE` definition — for provisioning/manual-creation pickers. Reuses `delivery_services.manage` (not `.catalog_manage` — picking FROM the catalog is a manage-tier action, not a catalog-administration one) OR `.read` for pure display purposes; callers pass whichever they've already resolved via `context.permissions`. This function itself only requires `.read`, the floor every other list call in this module already requires. */
export async function listActiveServiceDefinitions(): Promise<ServiceDefinition[]> {
  const { tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.read");
  return withTenantContext(tenantScope, (tx) => serviceDefinitionRepository.listActive(organizationId, tx));
}

const idSchema = z.object({ definitionId: z.string().uuid() });

export async function getServiceDefinition(rawInput: unknown): Promise<ServiceDefinition> {
  const input = parseOrThrow(idSchema, rawInput);
  const { tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.read");
  const definition = await withTenantContext(tenantScope, (tx) => serviceDefinitionRepository.findById(input.definitionId, tx));
  if (!definition || definition.organizationId !== organizationId) throw new NotFoundError("Service definition");
  return definition;
}

const updateSchema = z.object({
  definitionId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  category: z.enum(["SEO", "LOCAL_SEO", "WEB_DEVELOPMENT", "ECOMMERCE", "GHL_AUTOMATION", "CREATIVE", "OTHER"]).optional(),
  deliveryCadence: z.enum(["ONE_TIME", "RECURRING", "ONGOING"]).optional(),
  sortOrder: z.coerce.number().int().optional(),
});

/** Editable fields only — `code` is immutable once created (the durable reference future modules key off must never drift); renaming display copy is fine, changing the stable key is not. Editing never rewrites any existing `CustomerService`'s own historical facts — see service-management.md "Definition vs. customer engagement." */
export async function updateServiceDefinition(rawInput: unknown): Promise<ServiceDefinition> {
  const input = parseOrThrow(updateSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.catalog_manage");

  const definition = await withTenantContext(tenantScope, async (tx) => {
    const existing = await serviceDefinitionRepository.findById(input.definitionId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Service definition");
    const { definitionId, ...data } = input;
    return serviceDefinitionRepository.update(definitionId, data as Parameters<typeof serviceDefinitionRepository.update>[1], tx);
  });

  await auditDefinition(context, "services.definition_updated", organizationId, definition);
  return definition;
}

export async function archiveServiceDefinition(rawInput: unknown): Promise<ServiceDefinition> {
  const input = parseOrThrow(idSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.catalog_manage");

  const definition = await withTenantContext(tenantScope, async (tx) => {
    const existing = await serviceDefinitionRepository.findById(input.definitionId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Service definition");
    const updated = await serviceDefinitionRepository.archive(input.definitionId, tx);
    if (!updated) throw new ConflictError("This service definition was already archived. Reload and try again.");
    return updated;
  });

  await auditDefinition(context, "services.definition_archived", organizationId, definition);
  return definition;
}

export async function reactivateServiceDefinition(rawInput: unknown): Promise<ServiceDefinition> {
  const input = parseOrThrow(idSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveDeliveryServiceScope("delivery_services.catalog_manage");

  const definition = await withTenantContext(tenantScope, async (tx) => {
    const existing = await serviceDefinitionRepository.findById(input.definitionId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Service definition");
    const updated = await serviceDefinitionRepository.reactivate(input.definitionId, tx);
    if (!updated) throw new ConflictError("This service definition is not archived. Reload and try again.");
    return updated;
  });

  await auditDefinition(context, "services.definition_reactivated", organizationId, definition);
  return definition;
}
