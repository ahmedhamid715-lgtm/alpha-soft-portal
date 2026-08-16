import "server-only";
import type { OrganizationMembership, Role, User } from "@/generated/prisma/client";
import { getCurrentUser, getCurrentMembership } from "@/lib/auth/session-guard";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { rolePermissionRepository } from "@/server/repositories/permission-repository";
import { withTenantContext, setTenantOrganization, setTenantPlatformStaff, type TenantTransactionClient } from "@/lib/tenancy/context";
import type { PermissionKey } from "./permissions";

/**
 * Server-side authorization context (spec section 12) — resolves who the
 * caller is, which organization/membership/role applies, and the exact
 * permission set that grants, **without ever trusting a client-supplied
 * `userId`/`organizationId`/`role`**. Every field here is derived from
 * Module 04's authoritative session (`getCurrentUser()`) and a database
 * read — nothing is accepted as a parameter that a request body/query
 * string could forge.
 *
 * `organizationId`/`membership`/`role`/`permissions` describe ONE
 * resolved scope — either the platform scope (`resolvePlatformContext`)
 * or a specific organization's scope (`resolveOrganizationContext`).
 * They are deliberately never merged into one undifferentiated set (spec
 * section 7: "a platform administrator must not accidentally be treated
 * as an organization owner") — a caller who needs to know "is this
 * person also platform staff, independent of the organization scope
 * I'm checking" reads `isPlatformStaff`/`platformPermissions`, a
 * separately-resolved slice, never silently OR'd into `permissions`.
 *
 * **Module 06 (Multi-Tenancy/RLS)**: the membership/role/permission
 * reads below run inside `withTenantContext()`
 * (`lib/tenancy/context.ts`) — a real Postgres transaction, on the
 * restricted role RLS actually applies to, with `app.user_id`/
 * `app.organization_id`/`app.is_platform` set for its duration. This is
 * Module 05's own explicitly-documented extension point (spec section 7:
 * "Extend it only if necessary") — the resolved `AuthorizationContext`
 * shape and every existing caller's behavior are unchanged; what's new
 * is that the queries producing it are now RLS-protected, so a bug in
 * this file that forgot an organization filter would still not leak
 * cross-tenant data. See `docs/architecture/rls.md`.
 */
export interface AuthorizationContext {
  /** `null` when there is no authenticated session at all — see `authorize.ts`'s `requirePermission()`, which is what turns that into a thrown `AuthenticationError` rather than letting a caller accidentally dereference a null user. Any context returned FROM `requirePermission()`/`authorize()` is guaranteed to have a non-null `user` — only a direct call to `resolveOrganizationContext`/`resolvePlatformContext` can observe `null` here. */
  user: User | null;
  sessionId: string;
  /** The organization this context was resolved for — the platform organization's id for a platform context, or the specific organization's id for an organization context. `null` if no membership could be resolved at all. */
  organizationId: string | null;
  membership: OrganizationMembership | null;
  role: Role | null;
  /** Permission keys `role` grants, for the resolved scope only. */
  permissions: Set<PermissionKey>;
  /** True if the resolved membership's organization is the platform organization. */
  isPlatformStaff: boolean;
}

const EMPTY_CONTEXT_BASE = { membership: null, role: null, permissions: new Set<PermissionKey>() } as const;

async function permissionSetForRole(roleId: string | null, tx: TenantTransactionClient): Promise<Set<PermissionKey>> {
  if (!roleId) return new Set();
  const keys = await rolePermissionRepository.listPermissionKeysForRole(roleId, tx);
  return new Set(keys as PermissionKey[]);
}

/**
 * Resolves the caller's organization-scoped authorization context.
 * Builds on `getCurrentUser()`/`getCurrentMembership()` (Module 04) —
 * same "do not guess" rule as those functions: an explicit
 * `organizationId` resolves that specific membership; omitting it
 * resolves the caller's *sole* membership if they have exactly one,
 * `null` otherwise (spec section 13: "do not assume the first
 * organization returned from the database is automatically correct").
 */
export async function resolveOrganizationContext(organizationId?: string): Promise<AuthorizationContext> {
  const identity = await getCurrentUser();
  if (!identity) {
    return { user: null, sessionId: "", organizationId: null, isPlatformStaff: false, ...EMPTY_CONTEXT_BASE };
  }

  return withTenantContext(
    { userId: identity.user.id, organizationId: organizationId ?? null, isPlatformStaff: false },
    async (tx) => {
      const membership = await getCurrentMembership(organizationId, tx);
      // `getCurrentMembership()` (Module 04) resolves the row regardless of
      // its `status` — Module 04 never needed that distinction. Authorization
      // does: a SUSPENDED membership must grant zero permissions, not
      // whatever its (possibly still-`roleId`-bearing) row says. Checked
      // here, not by editing Module 04's function.
      if (!membership || membership.status !== "ACTIVE") {
        return {
          user: identity.user,
          sessionId: identity.sessionId,
          organizationId: organizationId ?? membership?.organizationId ?? null,
          isPlatformStaff: false,
          ...EMPTY_CONTEXT_BASE,
        };
      }

      // The real organization is now known. When `organizationId` wasn't
      // passed in (the sole-membership fallback), the transaction was
      // opened with `app.organization_id` unset — update it now so the
      // role/permission reads below (and anything a custom role's
      // organization-scoped RLS policy needs) resolve correctly.
      if (membership.organizationId !== organizationId) {
        await setTenantOrganization(tx, membership.organizationId);
      }

      const organization = await organizationRepository.findById(membership.organizationId, tx);
      // Spec section 21: SUSPENDED → customer access denied, ARCHIVED →
      // normal access denied. A real gap this module's own E2E test
      // caught (not found by inspection): this function fetched
      // `organization` only to read `isPlatform`, never checking its
      // `status` — a suspended/archived organization's members kept
      // full permissions as long as their own membership row stayed
      // ACTIVE. Checked here, the same "deny before granting anything"
      // shape as the membership-status check above.
      if (!organization || organization.status !== "ACTIVE") {
        return {
          user: identity.user,
          sessionId: identity.sessionId,
          organizationId: membership.organizationId,
          isPlatformStaff: false,
          ...EMPTY_CONTEXT_BASE,
        };
      }

      const role = membership.roleId ? await roleRepository.findById(membership.roleId, tx) : null;
      const permissions = await permissionSetForRole(membership.roleId, tx);

      return {
        user: identity.user,
        sessionId: identity.sessionId,
        organizationId: membership.organizationId,
        membership,
        role,
        permissions,
        isPlatformStaff: organization.isPlatform,
      };
    },
  );
}

/**
 * Resolves the caller's PLATFORM authorization context — their
 * membership in the one `isPlatform` organization, specifically, never
 * "whichever organization happens to be their sole membership" (spec
 * section 7's explicit boundary). A user who is both platform staff and
 * a member of an unrelated customer organization still resolves their
 * platform context correctly here; `resolveOrganizationContext()` would
 * return `null` for the same user (ambiguous — two memberships, no
 * explicit `organizationId`) by design.
 */
export async function resolvePlatformContext(): Promise<AuthorizationContext> {
  const identity = await getCurrentUser();
  if (!identity) {
    return { user: null, sessionId: "", organizationId: null, isPlatformStaff: false, ...EMPTY_CONTEXT_BASE };
  }

  // `Organization` itself has no RLS (see rls.md "Tables deliberately
  // without RLS" — enabling it would need a non-circular EXISTS-based
  // policy this module hasn't yet verified safe against every existing
  // call site), so this lookup runs on the plain `db` singleton exactly
  // as Module 05 originally wrote it — not inside the tenant transaction.
  const platformOrg = await organizationRepository.findPlatformOrganization();
  // Same fix as `resolveOrganizationContext()` above, applied here too —
  // a non-ACTIVE platform organization (an operational mistake, not an
  // expected state, but not one this function should silently ignore
  // either) must not grant platform-wide access.
  if (!platformOrg || platformOrg.status !== "ACTIVE") {
    return { user: identity.user, sessionId: identity.sessionId, organizationId: platformOrg?.id ?? null, isPlatformStaff: false, ...EMPTY_CONTEXT_BASE };
  }

  return withTenantContext(
    // `isPlatformStaff` starts false, not true — set only after the
    // membership below is actually verified. See `setTenantPlatformStaff`'s
    // doc comment for why starting optimistic would be the wrong default.
    { userId: identity.user.id, organizationId: platformOrg.id, isPlatformStaff: false },
    async (tx) => {
      const membership = await getCurrentMembership(platformOrg.id, tx);
      if (!membership || membership.status !== "ACTIVE") {
        return {
          user: identity.user,
          sessionId: identity.sessionId,
          organizationId: platformOrg.id,
          isPlatformStaff: false,
          ...EMPTY_CONTEXT_BASE,
        };
      }

      await setTenantPlatformStaff(tx, true);

      const role = membership.roleId ? await roleRepository.findById(membership.roleId, tx) : null;
      const permissions = await permissionSetForRole(membership.roleId, tx);

      return {
        user: identity.user,
        sessionId: identity.sessionId,
        organizationId: platformOrg.id,
        membership,
        role,
        permissions,
        isPlatformStaff: true,
      };
    },
  );
}
