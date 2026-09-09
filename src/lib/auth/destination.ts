import { SYSTEM_ROLES, type SystemRoleKey } from "@/lib/authorization/roles";

/**
 * Centralized post-login destination resolution (spec sections 6 & 33) —
 * the one place `role === "..."` branching happens, so it doesn't get
 * duplicated across the login action, the proxy, and every future
 * protected layout.
 *
 * Deliberately a pure function (membership in, path out) — no session/DB
 * access here, so it's trivially unit-testable and has no hidden
 * dependencies on request context.
 */
export const DESTINATIONS = {
  admin: "/admin",
  support: "/support",
  // Build 26 — Roadmap Module 20 builds the real Customer Portal this
  // constant always pointed at (see `(protected)/dashboard/page.tsx`'s
  // own prior "Module 04 verification placeholder" comment, now a
  // redirect to here). `/portal` itself handles every eligibility state
  // honestly (no membership / ambiguous multi-org / denied) — this
  // constant does not need to change again as Portal itself evolves.
  customer: "/portal",
} as const;

export interface DestinationMembership {
  /** The current membership's role key (see `membership-repository.ts`'s `SYSTEM_MEMBERSHIP_ROLES`, extended by Module 05's own system role catalog — `lib/authorization/roles.ts`). */
  role: string;
  organizationId: string;
}

/**
 * `membership` is `null` for a user with no resolvable organization
 * membership at all. Role SCOPE (`SYSTEM_ROLES[role].scope`) — not the
 * role's name — is what decides whether this is platform-staff routing
 * or ordinary organization routing; see Module 17's own live-testing
 * finding below for why that distinction actually matters, not just in
 * theory.
 *
 * **Found live, not by inspection (Module 17 follow-up)**: this
 * function used to route bare `"owner"`/`"admin"` straight to
 * `DESTINATIONS.admin` regardless of scope — correct for the PLATFORM
 * roles (`platform_owner`/`platform_admin`), but `"owner"`/`"admin"` are
 * also the ORGANIZATION-scope role keys reused by every regular tenant
 * organization (`roles.ts`'s own `owner`/`admin` entries, `scope:
 * "ORGANIZATION"`). An org's own admin — someone who administers only
 * that one organization, not the platform — landed on `/admin`, which
 * is exclusively platform-scope tooling (`(protected)/admin/page.tsx`'s
 * `TOOLS` list, every entry gated by a PLATFORM permission), and saw a
 * dead-end "No platform tools available" empty state. Fixed by routing
 * ORGANIZATION-scope `owner`/`admin` to that organization's own page
 * instead — real content they actually have access to, not a page that
 * structurally can never show them anything.
 */
export function resolveDestination(membership: DestinationMembership | null): string {
  if (!membership) return DESTINATIONS.customer;
  const { role, organizationId } = membership;

  // A pre-Module-05 free-text role key (`support@alpha-os.test`'s own
  // original seed), never in the catalog below — preserved exactly as
  // it always routed, since Module 04.
  if (role === "support") return DESTINATIONS.support;

  const definition = SYSTEM_ROLES[role as SystemRoleKey];
  if (!definition) {
    // An unrecognized role — any future role this catalog doesn't know
    // about yet, or a data inconsistency — the safe default is the
    // customer-facing surface, never an internal one.
    return DESTINATIONS.customer;
  }

  if (definition.scope === "PLATFORM") {
    switch (role) {
      case "platform_owner":
      case "platform_admin":
        return DESTINATIONS.admin;
      case "support_admin":
      case "support_agent":
        return DESTINATIONS.support;
      default:
        return DESTINATIONS.customer;
    }
  }

  // ORGANIZATION scope — route to what this role actually manages: that
  // one organization, never the platform-only admin surface.
  switch (role) {
    case "owner":
    case "admin":
      return `/organizations/${organizationId}`;
    default:
      // "member"/"viewer"/"manager"/"customer" — the safe default is the
      // customer-facing surface (Module 20 builds the real one).
      return DESTINATIONS.customer;
  }
}
