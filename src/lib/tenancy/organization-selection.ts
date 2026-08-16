import "server-only";
import { cookies } from "next/headers";
import { getCurrentMembership } from "@/lib/auth/session-guard";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { AuthorizationError } from "@/lib/errors/app-error";

/**
 * Organization selection (spec section 8) — a multi-organization user's
 * "current organization." Module 04/05 deliberately never guess this
 * (`getCurrentMembership()`/`resolveOrganizationContext()` return `null`
 * for a user with 0 or 2+ memberships and no explicit `organizationId`);
 * this is the mechanism that lets a caller supply one explicitly, sourced
 * from something more durable than a single request's form field.
 *
 * **The cookie is a hint, never a trust boundary.** Every read of it
 * (`getSelectedOrganizationId()`) is immediately re-validated against a
 * real, current membership via `getCurrentMembership()` — the same
 * function `resolveOrganizationContext()` itself uses — before anything
 * downstream treats it as real. A stale, forged, or stolen cookie value
 * naming an organization the caller no longer belongs to (membership
 * removed, suspended) or that has gone SUSPENDED/ARCHIVED resolves to
 * `null`, exactly as if no cookie were set at all — never a fallback to
 * "well, use it anyway." See spec section 8's explicit requirements list
 * and `docs/architecture/multi-tenancy.md` "Organization switching."
 */
const CURRENT_ORG_COOKIE = "alpha_os_current_organization";

/**
 * Reads the selected-organization cookie and validates it end to end:
 * real membership, `ACTIVE` membership status, `ACTIVE` organization
 * status. Returns `null` for anything else — including "no cookie set"
 * — never throws, since "no current organization" is a normal state
 * (spec section 21: suspended/archived orgs must not establish normal
 * access; this is where that's enforced for the selection mechanism
 * specifically, on top of the same check `resolveOrganizationContext()`
 * already does for membership status).
 */
export async function getSelectedOrganizationId(): Promise<string | null> {
  const cookieStore = await cookies();
  const candidateId = cookieStore.get(CURRENT_ORG_COOKIE)?.value;
  if (!candidateId) return null;

  const membership = await getCurrentMembership(candidateId);
  if (!membership || membership.status !== "ACTIVE") return null;

  const organization = await organizationRepository.findById(candidateId);
  if (!organization || organization.status !== "ACTIVE") return null;

  return candidateId;
}

/**
 * Switches the caller's current organization — spec section 8's exact
 * requirements: the user must actually (and currently) belong to the
 * target organization, a suspended membership cannot establish it, an
 * inactive organization cannot establish it, and switching never
 * modifies the user's own identity (no write to `User`/`UserSession`
 * happens here at all — only this cookie).
 */
export async function selectOrganization(organizationId: string): Promise<void> {
  const membership = await getCurrentMembership(organizationId);
  if (!membership || membership.status !== "ACTIVE") {
    throw new AuthorizationError("You are not an active member of that organization.");
  }

  const organization = await organizationRepository.findById(organizationId);
  if (!organization || organization.status !== "ACTIVE") {
    throw new AuthorizationError("That organization is not currently active.");
  }

  const cookieStore = await cookies();
  cookieStore.set(CURRENT_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Session-length, not persistent — matches the spirit of "a hint for
    // this session," not a long-lived preference record (which would be
    // a real per-user setting, a future module's job, not this cookie's).
  });
}

export async function clearSelectedOrganization(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(CURRENT_ORG_COOKIE);
}
