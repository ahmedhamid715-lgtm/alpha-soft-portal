import "server-only";
import { requirePermission } from "@/lib/authorization/authorize";
import type { TenantContextInput } from "@/lib/tenancy/context";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { PermissionKey } from "@/lib/authorization/permissions";
import { InternalServerError } from "@/lib/errors/app-error";

/**
 * Shared Local SEO / GBP authorization/tenant-scope resolution (Build 31
 * — Roadmap Module 25) — mirrors `seo-shared.ts`'s own
 * `resolveSeoScope()` exactly, for the identical reasoning: `local_seo.*`
 * are PLATFORM-scope permissions (Local SEO specialist work is Alpha
 * Page Rankers' own internal delivery work, never a customer
 * organization's own data), so `requirePermission()` always resolves
 * `resolvePlatformContext()`, and every Local SEO row's `organizationId`
 * is always that same resolved platform organization id. A SEPARATE
 * function from `resolveSeoScope()` — a SEPARATE specialist domain, own
 * permission namespace.
 */
export interface LocalSeoScope {
  context: AuthorizationContext;
  tenantScope: TenantContextInput;
  organizationId: string;
}

export async function resolveLocalSeoScope(permission: PermissionKey): Promise<LocalSeoScope> {
  const context = await requirePermission(permission);
  if (!context.organizationId) throw new InternalServerError({ details: { reason: "Platform organization context could not be resolved." } });
  return {
    context,
    tenantScope: { userId: context.user!.id, organizationId: context.organizationId, isPlatformStaff: true },
    organizationId: context.organizationId,
  };
}
