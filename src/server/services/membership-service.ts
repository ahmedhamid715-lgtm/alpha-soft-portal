import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { ConflictError, NotFoundError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging";
import { events } from "@/lib/platform/events";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { requirePermission } from "@/lib/authorization/authorize";
import { wouldRemoveLastOwner } from "./role-service";

/**
 * Membership lifecycle mutations that need the same last-owner guard as
 * role reassignment (spec section 27: "removing/demoting the final
 * organization owner" — removing and suspending are both covered, not
 * just the role-change case `role-service.ts` handles). Kept separate
 * from `role-service.ts` — this is membership lifecycle, not role
 * definition — but shares its `wouldRemoveLastOwner()` check so the
 * "would this leave zero owners" question has exactly one
 * implementation.
 */

const membershipActionSchema = z.object({ membershipId: z.string().uuid() });

export async function removeMember(rawInput: unknown): Promise<void> {
  const input = parseOrThrow(membershipActionSchema, rawInput);

  const membership = await membershipRepository.findById(input.membershipId);
  if (!membership) throw new NotFoundError("Membership");

  await requirePermission("members.remove", membership.organizationId);

  if (await wouldRemoveLastOwner(membership.organizationId, membership.id, "__removed__")) {
    throw new ConflictError("This organization would have no owner left. Assign another owner first.", {
      details: { reason: "last_owner" },
    });
  }

  await membershipRepository.remove(membership.id);

  logger.info("Member removed.", {
    operation: "membership.remove",
    organizationId: membership.organizationId,
    membershipId: membership.id,
  });
  await events.emit("MembershipRemoved", { membershipId: membership.id, organizationId: membership.organizationId });
}

const suspendMemberSchema = z.object({ membershipId: z.string().uuid(), status: z.enum(["ACTIVE", "SUSPENDED"]) });

export async function updateMemberStatus(rawInput: unknown): Promise<void> {
  const input = parseOrThrow(suspendMemberSchema, rawInput);

  const membership = await membershipRepository.findById(input.membershipId);
  if (!membership) throw new NotFoundError("Membership");

  await requirePermission("members.update", membership.organizationId);

  if (input.status === "SUSPENDED" && (await wouldRemoveLastOwner(membership.organizationId, membership.id, "__suspended__"))) {
    throw new ConflictError("This organization would have no active owner left. Assign another owner first.", {
      details: { reason: "last_owner" },
    });
  }

  await membershipRepository.updateStatus(membership.id, input.status);

  logger.info("Member status changed.", {
    operation: "membership.updateStatus",
    organizationId: membership.organizationId,
    membershipId: membership.id,
    status: input.status,
  });
  await events.emit("MembershipStatusChanged", {
    membershipId: membership.id,
    organizationId: membership.organizationId,
    status: input.status,
  });
}
