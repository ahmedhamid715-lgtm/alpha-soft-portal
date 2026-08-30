import "server-only";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext, type TenantContextInput } from "@/lib/tenancy/context";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { PermissionKey } from "@/lib/authorization/permissions";
import { InternalServerError, ValidationError } from "@/lib/errors/app-error";
import { membershipRepository } from "@/server/repositories/membership-repository";
import type { TransactionClient } from "@/lib/db/transaction";
import { db } from "@/lib/db/client";
import type { User } from "@/generated/prisma/client";

/**
 * Shared CRM authorization/tenant-scope resolution — every CRM service
 * (company/contact/lead/activity/task/lead-source/custom-field) needs the
 * exact same two steps, unlike Module 18's knowledge services (which had
 * a real org-vs-platform fork per operation): `crm.read`/`crm.manage` are
 * PLATFORM-scope permissions (see permissions.ts's own comment — CRM is
 * Alpha Page Rankers' own internal sales tool, never a customer
 * organization's data), so `requirePermission()` always resolves
 * `resolvePlatformContext()`, and every CRM row's `organizationId` is
 * always that same resolved platform organization id. Centralizing this
 * here (rather than duplicating it six times, the way `knowledge-source-
 * service.ts` duplicates its genuinely-different org/platform variants)
 * keeps that "always the platform org, never a customer org" invariant
 * enforced in exactly one place.
 */
export interface CrmScope {
  context: AuthorizationContext;
  tenantScope: TenantContextInput;
  organizationId: string;
}

export async function resolveCrmScope(permission: PermissionKey): Promise<CrmScope> {
  const context = await requirePermission(permission);
  // `requirePermission()` already guarantees `context.user` is non-null
  // and, since `crm.read`/`crm.manage` are PLATFORM-scope, that
  // `context.organizationId` is the real, verified platform organization
  // id (see `resolvePlatformContext()`'s own contract) — this check only
  // guards against that contract ever changing out from under this file.
  if (!context.organizationId) throw new InternalServerError({ details: { reason: "Platform organization context could not be resolved." } });
  return {
    context,
    tenantScope: { userId: context.user!.id, organizationId: context.organizationId, isPlatformStaff: true },
    organizationId: context.organizationId,
  };
}

/**
 * Platform staff, for "assign to" pickers (lead/task assignment) —
 * `crm.read` is enough to see who COULD be assigned; only `crm.manage`
 * can actually assign (each mutation's own `resolveCrmScope("crm.manage")`
 * call re-checks that). Bounded to 200 ACTIVE platform memberships, the
 * same realistic-size assumption `notifyAllActiveMembers()`'s own 500-cap
 * documents for organization membership generally — a real internal
 * sales team is far smaller than that.
 */
export async function listAssignableUsers(): Promise<User[]> {
  const { tenantScope, organizationId } = await resolveCrmScope("crm.read");
  const memberships = await withTenantContext(tenantScope, (tx) => membershipRepository.listForOrganization(organizationId, { page: 1, limit: 200 }, { status: "ACTIVE" }, tx));
  return memberships.items.map((m) => m.user);
}

/**
 * Confirms `userId` is an ACTIVE member of the resolved platform
 * organization — the real gate `crm-lead-service.ts`/`crm-task-service.ts`
 * must apply before accepting an `assignedToUserId`, not merely
 * `userRepository.findById()` (any existing `User` row, including a
 * customer-organization-only account, would otherwise pass). Confirmed
 * by Codex's own Phase 5 security review (Build 19): an assignee that
 * isn't real platform staff would then receive a `crm.task.assigned`
 * notification (subscribers.ts) whose title/body includes internal CRM
 * task content — a real cross-tenant disclosure path, not merely a data-
 * quality gap. Callers already inside a `withTenantContext()` block
 * should pass their own `tx` (membership rows are RLS-protected too);
 * `db` is only the fallback for a hypothetical caller outside one.
 */
export async function assertPlatformStaffMember(userId: string, organizationId: string, tx: TransactionClient | typeof db = db): Promise<void> {
  const membership = await membershipRepository.findByOrganizationAndUser(organizationId, userId, tx);
  if (!membership || membership.status !== "ACTIVE") {
    throw new ValidationError("assignedToUserId must be an active member of the platform organization.");
  }
}
