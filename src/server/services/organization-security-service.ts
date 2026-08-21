import "server-only";
import { z } from "zod";
import type { OrganizationInvitationPolicy } from "@/generated/prisma/client";
import { parseOrThrow } from "@/lib/validation/parse";
import { NotFoundError, ValidationError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging";
import { events } from "@/lib/platform/events";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { audit } from "@/lib/audit/service";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { invitationPolicyRepository } from "@/server/repositories/invitation-policy-repository";
import { InvalidDomainError, normalizeDomainList } from "@/lib/organizations/domains";

/**
 * Organization security, settings & governance (Module 12). This file
 * is deliberately narrow — see docs/architecture/organization-governance.md
 * "What Module 12 builds, and what it explicitly does not" for the
 * reasoning behind every boundary below, required by the spec's own
 * "if a setting cannot be enforced, do not expose it" instruction:
 *
 *   - **Invitation policy** — the ONE real, enforceable governance
 *     surface this module adds: `requireOwnerForInvitations` /
 *     `allowedDomains` / `blockedDomains` / `invitationExpiryHours`,
 *     read here and enforced at the one real chokepoint,
 *     `invitation-service.ts`'s `createInvitation()`.
 *   - **Session/idle-timeout policy** — NOT modeled. Sessions
 *     (`UserSession`, Module 04/10) are a property of a *user*, not of
 *     any one organization — a person with memberships in three
 *     organizations has exactly one session record, not three. An
 *     org-scoped "require re-auth after 30 minutes" setting has no
 *     mechanism that could actually enforce it without redesigning the
 *     session model itself (out of scope for this module — a governance
 *     UI that LOOKS like it does something but silently does nothing is
 *     worse than no UI at all).
 *   - **Membership governance beyond invitations** — NOT modeled.
 *     Who can suspend/remove/reassign a member's role is already fully,
 *     correctly governed by the existing `members.update`/
 *     `members.remove`/`roles.update` permissions (Module 05/07) — a
 *     second, parallel "membership policy" toggle would only create two
 *     competing sources of truth for the same decision.
 *   - **Notification governance** — NOT modeled. Per-category delivery
 *     is already a genuinely per-USER preference (Module 09,
 *     `notification-preference-service.ts`) by deliberate design (a
 *     person decides what lands in THEIR inbox); an org-level override
 *     would contradict that, not extend it.
 */

const DEFAULT_INVITATION_EXPIRY_HOURS = 168; // 7 days — matches `invitation-service.ts`'s own INVITATION_DURATION_MS default, kept in sync manually (see that file) since Prisma's schema default and this constant necessarily live in two places.
const MIN_INVITATION_EXPIRY_HOURS = 1;
const MAX_INVITATION_EXPIRY_HOURS = 720; // 30 days — long enough for any legitimate delay, short enough that a leaked invitation link can't be replayed indefinitely (same reasoning `invitation-service.ts`'s own 7-day default already documents, just bounding the configurable range instead of fixing one value).

export interface InvitationPolicyView {
  organizationId: string;
  /** `false` when no row exists yet — every field below is then the documented, code-level default, not a per-organization customization. */
  isCustomized: boolean;
  requireOwnerForInvitations: boolean;
  allowedDomains: string[];
  blockedDomains: string[];
  invitationExpiryHours: number;
}

function toView(organizationId: string, row: OrganizationInvitationPolicy | null): InvitationPolicyView {
  if (!row) {
    return {
      organizationId,
      isCustomized: false,
      requireOwnerForInvitations: false,
      allowedDomains: [],
      blockedDomains: [],
      invitationExpiryHours: DEFAULT_INVITATION_EXPIRY_HOURS,
    };
  }
  return {
    organizationId,
    isCustomized: true,
    requireOwnerForInvitations: row.requireOwnerForInvitations,
    allowedDomains: row.allowedDomains,
    blockedDomains: row.blockedDomains,
    invitationExpiryHours: row.invitationExpiryHours,
  };
}

const orgIdSchema = z.object({ organizationId: z.string().uuid() });

/** `organizations.security.read` — owner + admin (see `roles.ts`, `ORGANIZATION_FULL`). */
export async function getInvitationPolicy(rawInput: unknown): Promise<InvitationPolicyView> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  await requirePermission("organizations.security.read", input.organizationId);

  const organization = await organizationRepository.findById(input.organizationId);
  if (!organization) throw new NotFoundError("Organization");

  const row = await invitationPolicyRepository.findByOrganizationId(input.organizationId);
  return toView(input.organizationId, row);
}

const updateInvitationPolicySchema = z.object({
  organizationId: z.string().uuid(),
  requireOwnerForInvitations: z.boolean(),
  allowedDomains: z.array(z.string()).max(50),
  blockedDomains: z.array(z.string()).max(50),
  invitationExpiryHours: z.number().int().min(MIN_INVITATION_EXPIRY_HOURS).max(MAX_INVITATION_EXPIRY_HOURS),
});
export type UpdateInvitationPolicyInput = z.infer<typeof updateInvitationPolicySchema>;

/**
 * `organizations.security.update` — owner-only, granted directly on the
 * `owner` role (NOT part of `ORGANIZATION_FULL`, so `admin` never holds
 * it) — see that permission key's own doc comment in `permissions.ts`
 * for the self-escalation reasoning: `requireOwnerForInvitations` is a
 * restriction ON admins, so letting an admin hold the permission to turn
 * it back off would defeat the restriction entirely.
 */
export async function updateInvitationPolicy(rawInput: unknown): Promise<InvitationPolicyView> {
  const input = parseOrThrow(updateInvitationPolicySchema, rawInput);
  const context = await requirePermission("organizations.security.update", input.organizationId);

  const organization = await organizationRepository.findById(input.organizationId);
  if (!organization) throw new NotFoundError("Organization");

  let allowedDomains: string[];
  let blockedDomains: string[];
  try {
    allowedDomains = normalizeDomainList(input.allowedDomains);
    blockedDomains = normalizeDomainList(input.blockedDomains);
  } catch (error) {
    if (error instanceof InvalidDomainError) {
      throw new ValidationError(error.message, { details: { field: error.reason } });
    }
    throw error;
  }

  const overlap = allowedDomains.filter((d) => blockedDomains.includes(d));
  if (overlap.length > 0) {
    // A domain that is simultaneously allowed and blocked is a
    // contradiction, not a "blocked wins" or "allowed wins" tiebreak
    // worth silently resolving — the caller almost certainly made a
    // mistake, and guessing which list they meant would be worse than
    // asking them to fix it.
    throw new ValidationError(`"${overlap[0]}" cannot be in both the allowed and blocked domain lists.`, {
      details: { field: "allowedDomains" },
    });
  }

  const before = await invitationPolicyRepository.findByOrganizationId(input.organizationId);

  const updated = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    async (tx) => {
      const row = await invitationPolicyRepository.upsert(
        {
          organizationId: input.organizationId,
          requireOwnerForInvitations: input.requireOwnerForInvitations,
          allowedDomains,
          blockedDomains,
          invitationExpiryHours: input.invitationExpiryHours,
        },
        tx,
      );
      await audit.recordSuccess({
        action: "organization.invitation_policy.updated",
        organizationId: input.organizationId,
        resourceType: "organization_invitation_policy",
        resourceId: row.id,
        previousState: before
          ? {
              requireOwnerForInvitations: before.requireOwnerForInvitations,
              allowedDomains: before.allowedDomains,
              blockedDomains: before.blockedDomains,
              invitationExpiryHours: before.invitationExpiryHours,
            }
          : undefined,
        newState: {
          requireOwnerForInvitations: row.requireOwnerForInvitations,
          allowedDomains: row.allowedDomains,
          blockedDomains: row.blockedDomains,
          invitationExpiryHours: row.invitationExpiryHours,
        },
        tx,
      });
      return row;
    },
  );

  logger.info("Invitation policy updated.", {
    operation: "organization.invitation_policy.update",
    organizationId: input.organizationId,
    changedByUserId: context.user!.id,
  });
  await events.emit("organization.invitation_policy.updated", {
    organizationId: input.organizationId,
    changedByUserId: context.user!.id,
  });

  return toView(input.organizationId, updated);
}
