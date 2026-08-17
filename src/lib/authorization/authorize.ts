import "server-only";
import { resolveOrganizationContext, resolvePlatformContext, type AuthorizationContext } from "./context";
import { getPermissionDefinition, type PermissionKey } from "./permissions";
import { AuthenticationError, PermissionDeniedError } from "./errors";
import { audit } from "@/lib/audit/service";

/**
 * The centralized authorization engine (spec section 11) — the one place
 * "does this identity have this permission" is decided. Every future
 * Server Action/Route Handler/Server Component calls one of the four
 * functions below instead of inspecting `role`/`permissions` itself, the
 * same discipline `requireAuthenticatedUser()` established for
 * authentication in Module 04.
 *
 * Routing: each `PermissionKey` has a fixed `scope` in the catalog
 * (`permissions.ts`) — `requirePermission()`/`can()` use it to resolve
 * the correct context automatically (a PLATFORM permission resolves
 * `resolvePlatformContext()`, an ORGANIZATION permission resolves
 * `resolveOrganizationContext(organizationId)`), so a call site never has
 * to know or guess which kind of context a given permission needs. A
 * caller that genuinely needs to bypass this routing (e.g. an admin
 * screen checking a permission against an organization the platform
 * caller isn't a member of) uses `resolvePlatformContext`/
 * `resolveOrganizationContext` directly — seeresource-level
 * authorization in `policies/` for that pattern.
 */

async function resolveContextForPermission(permission: PermissionKey, organizationId?: string): Promise<AuthorizationContext> {
  const definition = getPermissionDefinition(permission);
  return definition.scope === "PLATFORM" ? resolvePlatformContext() : resolveOrganizationContext(organizationId);
}

/** UX-only check — never the basis for an actual authorization decision (spec section 16). Never throws; returns `false` for "not authenticated" the same as "authenticated but lacks the permission." */
export async function can(permission: PermissionKey, organizationId?: string): Promise<boolean> {
  const context = await resolveContextForPermission(permission, organizationId);
  return context.permissions.has(permission);
}

/** The negation of `can()` — reads better at some call sites (`if (await cannot(...)) return null`). */
export async function cannot(permission: PermissionKey, organizationId?: string): Promise<boolean> {
  return !(await can(permission, organizationId));
}

/**
 * The authoritative check (spec sections 16/18/19) — throws instead of
 * returning a boolean, for the Server Action/Route Handler pattern
 * ("authenticate → resolve context → validate input → authorize →
 * execute") where a failed check must stop execution, not be silently
 * ignored by a caller that forgets to check a return value.
 *
 * Throws `AuthenticationError` (401) if there's no session at all —
 * indistinguishable from Module 04's own 401s, since "not logged in" and
 * "logged in but lacking a permission" are different problems (spec
 * section 31: `UNAUTHENTICATED` vs. `FORBIDDEN`). Throws
 * `PermissionDeniedError` (403) if authenticated but the permission
 * isn't held. Returns the resolved `AuthorizationContext` on success so
 * the caller doesn't have to re-resolve identity/organization/membership
 * it already needed to make the decision.
 */
export async function requirePermission(permission: PermissionKey, organizationId?: string): Promise<AuthorizationContext> {
  const context = await resolveContextForPermission(permission, organizationId);
  if (!context.user) throw new AuthenticationError();
  if (!context.permissions.has(permission)) {
    // Best-effort (see audit-system.md's failure-semantics table — "a
    // denial, by definition, means no mutation transaction was ever
    // opened to share"). This is the one real enforcement chokepoint
    // (`can()`/`cannot()` never throw and are never audited here — see
    // Phase 12's "no noisy UI-interaction events"), so every audited
    // denial here reflects an actual blocked attempt, not a UI hint.
    await audit
      .recordDenied({
        action: "security.authorization.denied",
        organizationId: context.organizationId,
        resourceType: "permission",
        resourceId: undefined,
        resourceName: permission,
        metadata: { permission },
      })
      .catch((auditError) => {
        console.error("[audit] failed to record security.authorization.denied", auditError);
      });
    throw new PermissionDeniedError(permission, { organizationId: context.organizationId });
  }
  return context;
}

/**
 * Resource-level authorization (spec section 14) — a permission alone
 * ("`projects.read`") is never sufficient to prove access to a
 * *specific* resource ("Customer A's project"). `authorize()` composes a
 * permission check with a policy function that inspects the actual
 * resource; see `policies/` for the two general-purpose policies this
 * module ships (`belongsToOrganization`, `ownedByUser`) and the
 * `ResourcePolicy` extension point future modules implement their own
 * against (support cross-org access, "assigned to me," ...).
 */
export type ResourcePolicy<T> = (context: AuthorizationContext, resource: T) => boolean | Promise<boolean>;

export async function authorize<T>(
  permission: PermissionKey,
  resource: T,
  policy: ResourcePolicy<T>,
  organizationId?: string,
): Promise<AuthorizationContext> {
  const context = await requirePermission(permission, organizationId);
  const allowed = await policy(context, resource);
  if (!allowed) {
    throw new PermissionDeniedError(permission, { organizationId: context.organizationId });
  }
  return context;
}

export type { AuthorizationContext };
