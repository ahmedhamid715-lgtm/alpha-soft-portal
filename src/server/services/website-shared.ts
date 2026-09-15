import "server-only";
import { requirePermission } from "@/lib/authorization/authorize";
import type { TenantContextInput } from "@/lib/tenancy/context";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { PermissionKey } from "@/lib/authorization/permissions";
import { InternalServerError } from "@/lib/errors/app-error";

/**
 * Shared Website Development authorization/tenant-scope resolution
 * (Build 32 — Roadmap Module 26) — mirrors `local-seo-shared.ts`'s own
 * `resolveLocalSeoScope()` exactly, for the identical reasoning:
 * `website_development.*` are PLATFORM-scope permissions (Website
 * Development specialist work is Alpha Page Rankers' own internal
 * delivery work, never a customer organization's own data), so
 * `requirePermission()` always resolves `resolvePlatformContext()`, and
 * every Website Development row's `organizationId` is always that same
 * resolved platform organization id. A SEPARATE function from
 * `resolveSeoScope()`/`resolveLocalSeoScope()` — a THIRD, SEPARATE
 * specialist domain.
 */
export interface WebsiteDevScope {
  context: AuthorizationContext;
  tenantScope: TenantContextInput;
  organizationId: string;
}

export async function resolveWebsiteDevScope(permission: PermissionKey): Promise<WebsiteDevScope> {
  const context = await requirePermission(permission);
  if (!context.organizationId) throw new InternalServerError({ details: { reason: "Platform organization context could not be resolved." } });
  return {
    context,
    tenantScope: { userId: context.user!.id, organizationId: context.organizationId, isPlatformStaff: true },
    organizationId: context.organizationId,
  };
}
