import "server-only";
import { requirePermission } from "@/lib/authorization/authorize";
import type { TenantContextInput } from "@/lib/tenancy/context";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { PermissionKey } from "@/lib/authorization/permissions";
import { InternalServerError } from "@/lib/errors/app-error";

/**
 * Shared GHL Automation authorization/tenant-scope resolution (Build 34
 * — Roadmap Module 28) — mirrors `ecommerce-shared.ts`'s own
 * `resolveEcommerceDevScope()` exactly, for the identical reasoning:
 * `ghl_automation.*` are PLATFORM-scope permissions (GHL Automation
 * specialist work is Alpha Page Rankers' own internal delivery work,
 * never a customer organization's own data), so `requirePermission()`
 * always resolves `resolvePlatformContext()`, and every GHL Automation
 * row's `organizationId` is always that same resolved platform
 * organization id. A SEPARATE function from `resolveEcommerceDevScope()`/
 * `resolveWebsiteDevScope()`/`resolveSeoScope()`/`resolveLocalSeoScope()`
 * — a FIFTH, SEPARATE specialist domain.
 */
export interface GhlDevScope {
  context: AuthorizationContext;
  tenantScope: TenantContextInput;
  organizationId: string;
}

export async function resolveGhlDevScope(permission: PermissionKey): Promise<GhlDevScope> {
  const context = await requirePermission(permission);
  if (!context.organizationId) throw new InternalServerError({ details: { reason: "Platform organization context could not be resolved." } });
  return {
    context,
    tenantScope: { userId: context.user!.id, organizationId: context.organizationId, isPlatformStaff: true },
    organizationId: context.organizationId,
  };
}
