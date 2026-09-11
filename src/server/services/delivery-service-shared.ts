import "server-only";
import { requirePermission } from "@/lib/authorization/authorize";
import type { TenantContextInput } from "@/lib/tenancy/context";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { PermissionKey } from "@/lib/authorization/permissions";
import { InternalServerError } from "@/lib/errors/app-error";

/**
 * Shared Service Management authorization/tenant-scope resolution
 * (Build 29 — Roadmap Module 23) — mirrors `project-shared.ts`'s own
 * `resolveProjectScope()` / `crm-shared.ts`'s own `resolveCrmScope()`
 * exactly (same shape, same reasoning): `delivery_services.*` are
 * PLATFORM-scope permissions (Service Management is Alpha Page
 * Rankers' own internal operational catalog, never a customer
 * organization's own data), so `requirePermission()` always resolves
 * `resolvePlatformContext()`, and every `ServiceDefinition`/
 * `CustomerService` row's `organizationId` is always that same resolved
 * platform organization id.
 */
export interface DeliveryServiceScope {
  context: AuthorizationContext;
  tenantScope: TenantContextInput;
  organizationId: string;
}

export async function resolveDeliveryServiceScope(permission: PermissionKey): Promise<DeliveryServiceScope> {
  const context = await requirePermission(permission);
  if (!context.organizationId) throw new InternalServerError({ details: { reason: "Platform organization context could not be resolved." } });
  return {
    context,
    tenantScope: { userId: context.user!.id, organizationId: context.organizationId, isPlatformStaff: true },
    organizationId: context.organizationId,
  };
}
