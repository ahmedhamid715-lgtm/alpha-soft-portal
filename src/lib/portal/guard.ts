import "server-only";
import type { AuthorizationContext } from "@/lib/authorization/context";
import { resolvePortalContext, type PortalEligibleOrganization } from "./context";

/**
 * The one shared "can this request see a Portal page at all, and for
 * which organization" decision — every `(protected)/portal/**` page
 * calls this first, so the four possible states (no eligible
 * organization / ambiguous multi-org selection / permission denied /
 * ready) are handled identically everywhere instead of each page
 * re-deriving its own logic. Never a redirect loop or a 500 — every
 * state renders a real, honest page (see the portal layout's own
 * `PortalGate` component for the shared UI).
 */
export type PortalGuardResult =
  | { kind: "unauthenticated" }
  | { kind: "no-organizations" }
  | { kind: "needs-selection"; organizations: PortalEligibleOrganization[] }
  | { kind: "denied" }
  | { kind: "ready"; organizationId: string; authorization: AuthorizationContext };

export async function guardPortalPage(): Promise<PortalGuardResult> {
  const context = await resolvePortalContext();
  if (!context.user) return { kind: "unauthenticated" };
  if (context.eligibleOrganizations.length === 0) return { kind: "no-organizations" };
  if (!context.organizationId) return { kind: "needs-selection", organizations: context.eligibleOrganizations };
  if (!context.authorization.permissions.has("portal.access")) return { kind: "denied" };
  return { kind: "ready", organizationId: context.organizationId, authorization: context.authorization };
}
