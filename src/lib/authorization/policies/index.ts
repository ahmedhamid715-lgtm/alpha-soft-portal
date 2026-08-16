import type { AuthorizationContext } from "../context";

/**
 * The two general-purpose resource policies (spec section 14) every
 * future module's own policies build on or replace. Deliberately not a
 * larger library — "user is assigned to resource," "support has scoped
 * cross-org access," "temporary resource access" are all real future
 * needs (spec sections 14/21) this module explicitly does not implement,
 * only makes room for: any function matching `ResourcePolicy<T>`
 * (`authorize.ts`) plugs into the same `authorize()` call.
 */

/** The common case: a resource that belongs to exactly one organization. `authorize("projects.read", project, belongsToOrganization)`. */
export function belongsToOrganization<T extends { organizationId: string }>(
  context: AuthorizationContext,
  resource: T,
): boolean {
  return context.organizationId !== null && resource.organizationId === context.organizationId;
}

/** A resource owned by a specific user (not just their organization) — e.g. a future "my draft," "my assigned ticket." */
export function ownedByUser<T extends { userId: string }>(context: AuthorizationContext, resource: T): boolean {
  return context.user !== null && resource.userId === context.user.id;
}

/**
 * `belongsToOrganization`, but platform staff (any permission resolved
 * via the platform scope) bypass the organization-boundary check
 * entirely — the explicit, auditable version of "platform administrator
 * can act on any organization's resource," never an accidental
 * side-effect of how permission sets are merged (see `context.ts`'s top
 * comment). Use this, not `belongsToOrganization`, for a resource a
 * platform console screen needs to reach across every organization —
 * none exist yet in Module 05's shipped scope; this is the extension
 * point for when one does.
 */
export function belongsToOrganizationOrPlatformStaff<T extends { organizationId: string }>(
  context: AuthorizationContext,
  resource: T,
): boolean {
  return context.isPlatformStaff || belongsToOrganization(context, resource);
}

export type { ResourcePolicy } from "../authorize";
