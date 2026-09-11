import "server-only";
import { requirePermission } from "@/lib/authorization/authorize";
import type { TenantContextInput } from "@/lib/tenancy/context";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { PermissionKey } from "@/lib/authorization/permissions";
import { InternalServerError } from "@/lib/errors/app-error";

/**
 * Shared SEO OS authorization/tenant-scope resolution (Build 30 —
 * Roadmap Module 24) — mirrors `delivery-service-shared.ts`'s own
 * `resolveDeliveryServiceScope()` exactly: `seo.*` are PLATFORM-scope
 * permissions (SEO specialist work is Alpha Page Rankers' own internal
 * delivery work, never a customer organization's own data), so
 * `requirePermission()` always resolves `resolvePlatformContext()`, and
 * every SEO OS row's `organizationId` is always that same resolved
 * platform organization id.
 */
export interface SeoScope {
  context: AuthorizationContext;
  tenantScope: TenantContextInput;
  organizationId: string;
}

export async function resolveSeoScope(permission: PermissionKey): Promise<SeoScope> {
  const context = await requirePermission(permission);
  if (!context.organizationId) throw new InternalServerError({ details: { reason: "Platform organization context could not be resolved." } });
  return {
    context,
    tenantScope: { userId: context.user!.id, organizationId: context.organizationId, isPlatformStaff: true },
    organizationId: context.organizationId,
  };
}
