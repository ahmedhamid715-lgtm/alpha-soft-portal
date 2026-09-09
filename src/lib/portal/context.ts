import "server-only";
import type { Organization, User } from "@/generated/prisma/client";
import { getCurrentUser } from "@/lib/auth/session-guard";
import { getSelectedOrganizationId } from "@/lib/tenancy/organization-selection";
import { resolveOrganizationContext, type AuthorizationContext } from "@/lib/authorization/context";
import { membershipRepository } from "@/server/repositories/membership-repository";

/**
 * Customer Portal context resolution (Build 26 — Roadmap Module 20) —
 * the ONE place "is this caller a legitimate Customer Portal user, and
 * for which organization" is decided. Every Portal page/service calls
 * this (or `resolveOrganizationContext()` directly once an
 * `organizationId` is already known/verified), never re-derives
 * eligibility by inspecting `role`/`CrmContact`/anything else.
 *
 * **Eligibility** (see customer-portal.md "Eligibility"): an ACTIVE
 * `OrganizationMembership` in an ACTIVE, non-platform `Organization`.
 * `CrmContact` is never consulted — a CRM contact record with no real
 * `User` + membership grants nothing here, and never will implicitly
 * (see customer-portal.md "Contact/User linkage").
 *
 * **Multi-organization behavior**: reuses the EXISTING, already-
 * validated organization-selection cookie (`getSelectedOrganizationId()`
 * — Module 06) rather than inventing a second mechanism. A cookie
 * naming an org the caller no longer belongs to, or that isn't
 * PORTAL-eligible (suspended/archived/platform), is simply ignored —
 * never trusted. Exactly one eligible membership auto-selects; two or
 * more with no (or a stale) selection resolves `organizationId: null`,
 * and the calling page renders the organization-picker state instead of
 * guessing.
 */
export interface PortalEligibleOrganization {
  id: string;
  name: string;
  displayName: string;
  slug: string;
}

export interface PortalContext {
  user: User | null;
  /** Every organization this user could legitimately use the Portal for right now — always independently re-verified, never cached across requests. */
  eligibleOrganizations: PortalEligibleOrganization[];
  /** The resolved current organization for this request, or `null` if none (no eligible org) or ambiguous (2+ eligible, no valid selection). */
  organizationId: string | null;
  /** Full authorization context for `organizationId` — `permissions` is empty and `organizationId` is `null` when nothing resolved. Never trust `organizationId` above without also checking this succeeded. */
  authorization: AuthorizationContext;
}

const EMPTY_AUTHORIZATION: AuthorizationContext = {
  user: null,
  sessionId: "",
  organizationId: null,
  membership: null,
  role: null,
  permissions: new Set(),
  isPlatformStaff: false,
};

function isEligible(organization: Pick<Organization, "status" | "isPlatform">): boolean {
  return organization.status === "ACTIVE" && !organization.isPlatform;
}

export async function resolvePortalContext(): Promise<PortalContext> {
  const identity = await getCurrentUser();
  if (!identity) {
    return { user: null, eligibleOrganizations: [], organizationId: null, authorization: EMPTY_AUTHORIZATION };
  }

  const memberships = await membershipRepository.listForUser(identity.user.id);
  const eligible = memberships.filter((m) => m.status === "ACTIVE" && isEligible(m.organization));
  const eligibleOrganizations: PortalEligibleOrganization[] = eligible.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    displayName: m.organization.displayName,
    slug: m.organization.slug,
  }));

  let organizationId: string | null = null;
  if (eligible.length === 1) {
    organizationId = eligible[0].organizationId;
  } else if (eligible.length > 1) {
    const selected = await getSelectedOrganizationId();
    if (selected && eligible.some((m) => m.organizationId === selected)) {
      organizationId = selected;
    }
  }

  // Re-resolves full authorization independently — `resolveOrganizationContext()`
  // never trusts that the membership lookup above is still current (a
  // membership could theoretically be revoked between the two reads);
  // this is the same "re-verify, don't just trust an earlier read"
  // discipline every other caller of this function already follows.
  const authorization = organizationId ? await resolveOrganizationContext(organizationId) : { ...EMPTY_AUTHORIZATION, user: identity.user, sessionId: identity.sessionId };

  // `authorization.membership` is the real "did this actually resolve"
  // signal (see `resolveOrganizationContext()`'s own contract — it
  // returns a non-null `organizationId` even on a denial, purely for
  // error-message purposes, but leaves `membership`/`permissions` empty).
  // Never expose `organizationId` as "resolved" unless a real, ACTIVE
  // membership backs it.
  const resolvedOrganizationId = authorization.membership ? authorization.organizationId : null;

  return { user: identity.user, eligibleOrganizations, organizationId: resolvedOrganizationId, authorization };
}
