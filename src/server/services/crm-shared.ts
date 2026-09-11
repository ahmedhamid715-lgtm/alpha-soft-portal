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
  // Build 29 Codex Security Engineer finding SM-SEC-02 — excludes only
  // globally SUSPENDED/DEACTIVATED users, matching
  // `assertPlatformStaffMember()`'s own identical (and identically
  // reasoned) filter below exactly — a picker must never OFFER an
  // account its own assignment check would then reject, and must never
  // WITHHOLD one it would actually accept (a real, not-yet-first-login
  // `INVITED` staff member stays offered).
  return memberships.items.filter((m) => m.user.status !== "SUSPENDED" && m.user.status !== "DEACTIVATED").map((m) => m.user);
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
  // Build 29 Codex Security Engineer finding SM-SEC-02 — an ACTIVE
  // membership alone does not mean the underlying `User` is still
  // usable: global suspension/deactivation (`user-management-service.ts`)
  // deliberately leaves memberships untouched, so a globally disabled
  // account could otherwise still pass this check and be assigned real
  // work — including receiving a notification email with customer/
  // service content. Rejects only SUSPENDED/DEACTIVATED — NOT `INVITED`
  // (a real platform staff member who simply hasn't completed their
  // first sign-in yet is still legitimately assignable; only
  // `suspendUser()`/`deactivateUser()` reach SUSPENDED/DEACTIVATED, and
  // reactivation is the only way back out — see that file's own
  // "ACTIVE → SUSPENDED" / "SUSPENDED|DEACTIVATED → ACTIVE" transition
  // comments). A membership carries no denormalized `User.status` of
  // its own, so this is a genuinely separate lookup, not extra work
  // folded into the query above.
  const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user || user.status === "SUSPENDED" || user.status === "DEACTIVATED") {
    throw new ValidationError("assignedToUserId must not be a suspended or deactivated platform user.");
  }
}

/**
 * Every ACTIVE platform-org member whose CURRENT role grants
 * `permissionKey` — Build 22's own fan-out target for `crm.proposal.
 * approval_requested` (there is no separate "approver assignment" list;
 * whoever's role currently grants `crm.proposal.approve` is notified).
 * Reads the live `role_permissions`/`roles`/`organization_memberships`
 * tables directly (the same source of truth `requirePermission()` itself
 * resolves from) rather than hardcoding a role-key list, so a future
 * grant change is reflected here automatically. `Role`/`Permission`
 * carry no RLS (global RBAC catalog, not tenant-scoped CRM data), so this
 * reads the plain `db` client, not a tenant-scoped `tx`.
 */
export async function listUsersWithPermission(permissionKey: PermissionKey, organizationId: string): Promise<User[]> {
  const roles = await db.role.findMany({
    where: { rolePermissions: { some: { permission: { key: permissionKey } } } },
    include: { memberships: { where: { organizationId, status: "ACTIVE" }, include: { user: true } } },
  });
  const users = new Map<string, User>();
  for (const role of roles) {
    for (const membership of role.memberships) users.set(membership.user.id, membership.user);
  }
  return [...users.values()];
}
