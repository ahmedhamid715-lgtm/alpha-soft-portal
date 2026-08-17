import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { ConflictError, NotFoundError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging";
import { events } from "@/lib/platform/events";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import type { AuthorizationContext } from "@/lib/authorization/context";
import { wouldRemoveLastOwner } from "./role-service";
import { audit } from "@/lib/audit/service";

/** Module 06 — see role-service.ts's identical helper for why the mutation runs inside the already-verified context, not a re-derived one. */
function tenantInputFor(context: AuthorizationContext) {
  return { userId: context.user!.id, organizationId: context.organizationId, isPlatformStaff: context.isPlatformStaff };
}

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

  const context = await requirePermission("members.remove", membership.organizationId);

  if (await wouldRemoveLastOwner(membership.organizationId, membership.id, "__removed__")) {
    throw new ConflictError("This organization would have no owner left. Assign another owner first.", {
      details: { reason: "last_owner" },
    });
  }

  const targetUser = await userRepository.findById(membership.userId);

  await withTenantContext(tenantInputFor(context), async (tx) => {
    await membershipRepository.remove(membership.id, tx);
    await audit.recordSuccess({
      action: "organization.member.removed",
      organizationId: membership.organizationId,
      resourceType: "membership",
      resourceId: membership.id,
      resourceName: targetUser?.name ?? targetUser?.email ?? undefined,
      previousState: { status: membership.status, role: membership.role },
      tx,
    });
  });

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

  const context = await requirePermission("members.update", membership.organizationId);

  if (input.status === "SUSPENDED" && (await wouldRemoveLastOwner(membership.organizationId, membership.id, "__suspended__"))) {
    throw new ConflictError("This organization would have no active owner left. Assign another owner first.", {
      details: { reason: "last_owner" },
    });
  }

  const targetUser = await userRepository.findById(membership.userId);

  await withTenantContext(tenantInputFor(context), async (tx) => {
    await membershipRepository.updateStatus(membership.id, input.status, tx);
    await audit.recordSuccess({
      action: input.status === "SUSPENDED" ? "organization.member.suspended" : "organization.member.reactivated",
      organizationId: membership.organizationId,
      resourceType: "membership",
      resourceId: membership.id,
      resourceName: targetUser?.name ?? targetUser?.email ?? undefined,
      previousState: { status: membership.status },
      newState: { status: input.status },
      tx,
    });
  });

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
