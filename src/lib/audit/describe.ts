import type { AuditEvent } from "@/generated/prisma/client";
import { getAuditActionDefinition, isAuditActionKey } from "./catalog";

/**
 * A one-sentence, human-readable line for the event-detail UI (spec
 * Phase 17) — "Austin changed Ahmed's role from Member to
 * Administrator." Falls back to the catalog's own generic description
 * when an event's action has no specific template, or when the action
 * isn't recognized at all (an older/removed catalog entry — a real
 * possibility for a table that's genuinely append-only forever).
 *
 * Deliberately its own module, not part of `query.ts` — this is pure
 * presentation logic with no dependency on the permission-gated,
 * `"server-only"` query path (`query.ts` transitively imports
 * `session-guard.ts` → next-auth, which is both unnecessary for a plain
 * string-formatting function and, in practice, made this function hard
 * to unit-test in isolation — see `describe-event.test.ts`).
 */
export function describeAuditEvent(event: AuditEvent): string {
  const actor = event.actorDisplayName ?? (event.actorType === "SYSTEM" ? "The system" : "Someone");
  const resource = event.resourceName ?? "a resource";

  switch (event.action) {
    case "organization.member.role_changed": {
      const prev = (event.previousState as { role?: string } | null)?.role;
      const next = (event.newState as { role?: string } | null)?.role;
      return prev && next ? `${actor} changed ${resource}'s role from ${prev} to ${next}.` : `${actor} changed ${resource}'s role.`;
    }
    case "organization.owner.transfer_completed":
      return `${actor} transferred ownership of the organization to ${resource}.`;
    case "organization.member.invited":
      return `${actor} invited ${resource} to join the organization.`;
    case "organization.member.invitation.accepted":
      return `${resource} accepted an invitation to join the organization.`;
    case "organization.member.invitation.revoked":
      return `${actor} revoked an invitation to ${resource}.`;
    case "organization.member.suspended":
      return `${actor} suspended ${resource}'s access.`;
    case "organization.member.reactivated":
      return `${actor} reactivated ${resource}'s access.`;
    case "organization.member.removed":
      return `${actor} removed ${resource} from the organization.`;
    case "organization.suspended":
      return `${actor} suspended ${resource}.`;
    case "organization.reactivated":
      return `${actor} reactivated ${resource}.`;
    case "organization.archived":
      return `${actor} archived ${resource}.`;
    case "organization.created":
      return `${actor} created ${resource}.`;
    case "auth.login.success":
      return `${actor} signed in.`;
    case "auth.login.failure":
      return `A sign-in attempt failed for ${event.actorDisplayName ?? "an unknown account"}.`;
    case "auth.logout":
      return `${actor} signed out.`;
    case "security.authorization.denied":
      return `${actor} was denied permission to perform an action.`;
    default:
      return isAuditActionKey(event.action) ? getAuditActionDefinition(event.action).description : `${actor} performed ${event.action}.`;
  }
}
