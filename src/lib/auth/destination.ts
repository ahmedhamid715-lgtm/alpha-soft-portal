/**
 * Centralized post-login destination resolution (spec sections 6 & 33) —
 * the one place `role === "..."` branching happens, so it doesn't get
 * duplicated across the login action, the proxy, and every future
 * protected layout. Module 05 (RBAC) is expected to replace or extend
 * this function's internals, not every call site that calls it.
 *
 * Deliberately a pure function (role in, path out) — no session/DB access
 * here, so it's trivially unit-testable and has no hidden dependencies on
 * request context.
 */
export const DESTINATIONS = {
  admin: "/admin",
  support: "/support",
  customer: "/dashboard",
} as const;

/**
 * `role` is the current membership's role key (see
 * `membership-repository.ts`'s `SYSTEM_MEMBERSHIP_ROLES`, extended by
 * Module 05's own system role catalog — `lib/authorization/roles.ts`),
 * or `null` for a user with no resolvable organization membership at
 * all. `owner`/`admin` (organization-scope) and `platform_owner`/
 * `platform_admin` (platform-scope) all route to the admin destination —
 * this is post-login UX routing only, not an authorization decision;
 * `/admin` itself is what actually enforces who may stay (see
 * `(protected)/admin/page.tsx`'s `requirePermission()` call). `support`
 * and `support_admin`/`support_agent` both route to the support
 * destination for the same reason.
 */
export function resolveDestination(role: string | null): string {
  switch (role) {
    case "owner":
    case "admin":
    case "platform_owner":
    case "platform_admin":
      return DESTINATIONS.admin;
    case "support":
    case "support_admin":
    case "support_agent":
      return DESTINATIONS.support;
    default:
      // "member", any future role this function doesn't recognize yet, or
      // no membership at all — the safe default is the customer-facing
      // surface, never an internal one.
      return DESTINATIONS.customer;
  }
}
