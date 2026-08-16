import { AuthenticationError, AuthorizationError, NotFoundError } from "@/lib/errors/app-error";
import type { PermissionKey } from "./permissions";

/**
 * Authorization-specific errors (spec section 31) — thin subclasses of
 * Module 01's existing error architecture (`lib/errors/app-error.ts`),
 * not a second error system. Three internally-distinct outcomes:
 *
 *   - `AuthenticationError` (401, reused as-is) — Module 04's own class:
 *     "we don't know who you are." `authorize.ts` throws this directly
 *     (not a subclass) when there's no session at all, so it's
 *     indistinguishable from Module 04's own 401s to any caller.
 *   - `PermissionDeniedError` (403) — "we know who you are; you may not
 *     do this." Carries the permission key in `details` for logging/test
 *     assertions, never in the client-facing message (spec section 31:
 *     "avoid leaking... "  — the message stays the generic
 *     `AuthorizationError` default).
 *   - `ResourceScopeError` (404, not 403) — spec section 31's explicit
 *     enumeration-avoidance instruction: a customer requesting another
 *     organization's resource by ID should see the same "not found" a
 *     genuinely-nonexistent ID produces, not a 403 that confirms the
 *     resource exists but belongs to someone else. See `policies/` for
 *     where this gets thrown.
 */
export class PermissionDeniedError extends AuthorizationError {
  constructor(permission: PermissionKey, options?: { organizationId?: string | null }) {
    super("You do not have permission to perform this action.", {
      details: { permission, organizationId: options?.organizationId ?? null },
    });
  }
}

export class ResourceScopeError extends NotFoundError {
  constructor(resource = "Resource") {
    super(resource);
  }
}

export { AuthenticationError, AuthorizationError };
