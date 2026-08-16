import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { sessionRepository } from "@/server/repositories/session-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { AuthenticationError, AuthorizationError } from "@/lib/errors/app-error";
import type { OrganizationMembership, User } from "@/generated/prisma/client";

/**
 * The one authoritative "is this request actually authenticated" check
 * (spec section 19/20) — every protected Server Component, Server
 * Action, and Route Handler calls one of the functions below instead of
 * inspecting `auth()`'s JWT claims directly. This is what makes
 * `proxy.ts`'s cheap JWT-only check safe to keep cheap: the real
 * decision (is the session actually still valid — not revoked, not
 * expired server-side, account still `ACTIVE`) always happens here.
 */
export interface CurrentIdentity {
  user: User;
  sessionId: string;
}

/** Returns `null` for any unauthenticated/invalid/revoked state — never throws. Use this where "not logged in" is a normal, handleable case (e.g. a page that renders differently for guests). */
export async function getCurrentUser(): Promise<CurrentIdentity | null> {
  const session = await auth();
  if (!session?.user?.id || !session.sessionId) return null;

  const userSession = await sessionRepository.findById(session.sessionId);
  if (!userSession || userSession.revokedAt || userSession.expiresAt.getTime() < Date.now()) {
    return null;
  }

  const user = await userRepository.findById(session.user.id);
  if (!user || user.status !== "ACTIVE") return null;

  await maybeTouchSession(userSession.id, userSession.lastActiveAt);

  return { user, sessionId: userSession.id };
}

/** Throws `AuthenticationError` (safe, generic — see errors.md) instead of returning `null`. Use this at the top of anything that must not proceed unauthenticated — the normal case for a protected Server Action or Route Handler, where a thrown `AppError` is the correct contract (translated to a structured 401 by `apiError()`/the action's own error handling). **Do not call this directly from a Server Component page/layout** — see `requireAuthenticatedPage()` below. */
export async function requireAuthenticatedUser(): Promise<CurrentIdentity> {
  const identity = await getCurrentUser();
  if (!identity) throw new AuthenticationError();
  return identity;
}

/**
 * The Server-Component-safe equivalent of `requireAuthenticatedUser()` —
 * for a page/layout, not a Server Action or Route Handler. A thrown
 * `AppError` has nowhere to go from a React Server Component render: it
 * surfaces as Next.js's generic uncaught-error page, an **HTTP 500**, not
 * a 401 or a redirect. This was a real bug this module's own security
 * audit caught by revoking a live session directly in the database
 * (bypassing `signOut()`) and replaying the still-otherwise-valid JWT
 * cookie against a protected page: access was correctly *denied* — no
 * data leaked, the thrown error's message/stack never reached the
 * response body — but the visitor got a broken 500 instead of a clean
 * bounce back to `/login`. Every currently-protected page
 * ((protected)/layout.tsx) uses this, not `requireAuthenticatedUser()`
 * directly.
 */
export async function requireAuthenticatedPage(): Promise<CurrentIdentity> {
  try {
    return await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      redirect("/login");
    }
    throw error;
  }
}

/**
 * Resolves the caller's membership in a specific organization, or — if
 * `organizationId` is omitted — their *sole* membership if they have
 * exactly one. A user with zero or multiple memberships and no explicit
 * `organizationId` gets `null`: this module deliberately does not guess
 * which of several organizations is "current" (spec section 22/33 — "do
 * not make dangerous assumptions... document how the initial context is
 * selected"). Module 06 (Multi-Tenancy) owns real organization-switching
 * (a cookie, a URL segment, a picker UI); this is the minimal, honest
 * foundation that doesn't paint that module into a corner.
 */
export async function getCurrentMembership(organizationId?: string): Promise<OrganizationMembership | null> {
  const identity = await getCurrentUser();
  if (!identity) return null;

  if (organizationId) {
    return membershipRepository.findByOrganizationAndUser(organizationId, identity.user.id);
  }

  const memberships = await membershipRepository.listForUser(identity.user.id);
  return memberships.length === 1 ? memberships[0] : null;
}

export async function requireOrganizationContext(organizationId?: string): Promise<OrganizationMembership> {
  const membership = await getCurrentMembership(organizationId);
  if (!membership) {
    throw new AuthorizationError("No organization context could be resolved for this request.");
  }
  return membership;
}

// --- internals -------------------------------------------------------------

const TOUCH_INTERVAL_MS = 5 * 60 * 1000; // don't write on every single request
async function maybeTouchSession(sessionId: string, lastActiveAt: Date): Promise<void> {
  if (Date.now() - lastActiveAt.getTime() > TOUCH_INTERVAL_MS) {
    await sessionRepository.touch(sessionId);
  }
}
