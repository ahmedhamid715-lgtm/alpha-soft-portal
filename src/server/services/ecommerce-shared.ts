import "server-only";
import { requirePermission } from "@/lib/authorization/authorize";
import type { TenantContextInput } from "@/lib/tenancy/context";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { PermissionKey } from "@/lib/authorization/permissions";
import { InternalServerError } from "@/lib/errors/app-error";

/**
 * Shared E-Commerce Development authorization/tenant-scope resolution
 * (Build 33 — Roadmap Module 27) — mirrors `website-shared.ts`'s own
 * `resolveWebsiteDevScope()` exactly, for the identical reasoning:
 * `ecommerce_development.*` are PLATFORM-scope permissions (E-Commerce
 * Development specialist work is Alpha Page Rankers' own internal
 * delivery work, never a customer organization's own data), so
 * `requirePermission()` always resolves `resolvePlatformContext()`, and
 * every E-Commerce Development row's `organizationId` is always that
 * same resolved platform organization id. A SEPARATE function from
 * `resolveWebsiteDevScope()`/`resolveSeoScope()`/`resolveLocalSeoScope()`
 * — a FOURTH, SEPARATE specialist domain.
 */
export interface EcommerceDevScope {
  context: AuthorizationContext;
  tenantScope: TenantContextInput;
  organizationId: string;
}

export async function resolveEcommerceDevScope(permission: PermissionKey): Promise<EcommerceDevScope> {
  const context = await requirePermission(permission);
  if (!context.organizationId) throw new InternalServerError({ details: { reason: "Platform organization context could not be resolved." } });
  return {
    context,
    tenantScope: { userId: context.user!.id, organizationId: context.organizationId, isPlatformStaff: true },
    organizationId: context.organizationId,
  };
}
