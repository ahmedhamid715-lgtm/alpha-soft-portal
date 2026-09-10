import "server-only";
import { requirePermission } from "@/lib/authorization/authorize";
import type { TenantContextInput } from "@/lib/tenancy/context";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { PermissionKey } from "@/lib/authorization/permissions";
import { InternalServerError } from "@/lib/errors/app-error";

/**
 * Shared Task Management authorization/tenant-scope resolution — mirrors
 * `crm-shared.ts`'s own `resolveCrmScope()` / `project-shared.ts`'s own
 * `resolveProjectScope()` exactly. `task_management.*` are PLATFORM-scope
 * permissions (this is Alpha Page Rankers' own internal operational
 * surface, never a customer organization's own data).
 */
export interface TaskManagementScope {
  context: AuthorizationContext;
  tenantScope: TenantContextInput;
  organizationId: string;
}

export async function resolveTaskManagementScope(permission: PermissionKey): Promise<TaskManagementScope> {
  const context = await requirePermission(permission);
  if (!context.organizationId) throw new InternalServerError({ details: { reason: "Platform organization context could not be resolved." } });
  return {
    context,
    tenantScope: { userId: context.user!.id, organizationId: context.organizationId, isPlatformStaff: true },
    organizationId: context.organizationId,
  };
}
