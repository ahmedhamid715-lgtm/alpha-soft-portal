import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging";
import { events } from "@/lib/platform/events";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { roleRepository } from "@/server/repositories/role-repository";
import { userRepository } from "@/server/repositories/user-repository";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext, type TenantTransactionClient } from "@/lib/tenancy/context";
import { audit } from "@/lib/audit/service";

/**
 * Ownership transfer (spec sections 20/21/46) — deliberately its own
 * file, not folded into `role-service.ts`'s `assignRole()`, because it
 * needs a genuinely different concurrency strategy: `assignRole()`'s
 * last-owner check (a `COUNT` before the write) is correct for the
 * "assign any role to any membership" case, but ownership transfer's
 * "old owner → lower role, new owner → owner, atomically, never zero
 * owners" is a two-row swap where two concurrent transfer attempts on
 * the SAME organization could both pass their own pre-checks before
 * either commits (spec section 46's explicit race test). This uses
 * Postgres row-level locking (`SELECT ... FOR UPDATE` on the
 * organization row) to serialize concurrent transfers on the same
 * organization — the second waits for the first to commit, then
 * re-validates against the now-current state rather than stale data it
 * read before the lock.
 */

const transferOwnershipSchema = z.object({
  organizationId: z.string().uuid(),
  /** The membership becoming the new owner — never a `userId` (spec section 48: membership, not identity, is what's being granted a role) and never validated as "the caller's own" the way the FROM side is. */
  toMembershipId: z.string().uuid(),
});

/**
 * `fromMembershipId` (whose ownership is being given up) is deliberately
 * **not** a parameter — it's always the caller's own membership,
 * resolved server-side from `requirePermission()`'s verified
 * `AuthorizationContext`. This is what makes the whole operation safe
 * against spec section 21's "attacker cannot transfer ownership": there
 * is no `fromMembershipId` a request could forge to target a *different*
 * owner's membership. Only permission `ownership.transfer` — granted
 * exclusively to the `owner` system role (`roles.ts`), not `admin` —
 * even reaches this function at all.
 */
export async function transferOwnership(rawInput: unknown): Promise<void> {
  const input = parseOrThrow(transferOwnershipSchema, rawInput);
  const context = await requirePermission("ownership.transfer", input.organizationId);

  if (!context.membership || context.membership.role !== "owner") {
    // Belt-and-suspenders — `ownership.transfer` is only ever granted to
    // the `owner` role, so this should be unreachable, but the operation
    // is sensitive enough to double-check rather than trust the
    // permission grant alone.
    throw new ValidationError("Only the current organization owner can transfer ownership.");
  }
  const fromMembershipId = context.membership.id;

  if (input.toMembershipId === fromMembershipId) {
    throw new ValidationError("You are already the owner.");
  }

  const ownerRole = await roleRepository.findSystemRoleByKey("owner");
  const adminRole = await roleRepository.findSystemRoleByKey("admin");
  if (!ownerRole || !adminRole) throw new NotFoundError("System role");

  // Module 09's own event emit (below, after the transaction commits)
  // needs `fromUserId`/`toUserId` — captured here, inside the
  // transaction, where `currentFrom`/`target` are in scope, and
  // returned out. Neither variable exists in the outer function scope
  // (a real bug this module's own reconnaissance pass found: the
  // previous version of the code below referenced `currentFrom`/`target`
  // directly at emit time, which doesn't compile — those bindings are
  // local to this callback).
  const { fromUserId, toUserId } = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    async (tx) => {
      // Serializes concurrent transfer attempts on this exact
      // organization — a second transaction's own `FOR UPDATE` on the
      // same row blocks here until this one commits or rolls back, then
      // proceeds against genuinely current data, not a stale read.
      await lockOrganizationForTransfer(tx, input.organizationId);

      // Re-read post-lock — the caller's own membership may have been
      // changed by a transfer that committed while this transaction was
      // waiting for the lock.
      const currentFrom = await membershipRepository.findById(fromMembershipId, tx);
      if (!currentFrom || currentFrom.role !== "owner" || currentFrom.organizationId !== input.organizationId) {
        throw new ConflictError("Ownership has already changed — you are no longer the current owner.");
      }

      const target = await membershipRepository.findById(input.toMembershipId, tx);
      if (!target || target.organizationId !== input.organizationId) {
        throw new NotFoundError("Membership");
      }
      if (target.status !== "ACTIVE") {
        // Spec section 21: "suspended member cannot become owner" /
        // "external user cannot become owner without membership" — a
        // non-ACTIVE membership (SUSPENDED, or INVITED-and-never-
        // accepted) fails here.
        throw new ValidationError("The selected member must have an active membership to become owner.");
      }

      await membershipRepository.updateRoleAssignment(fromMembershipId, { role: "admin", roleId: adminRole.id }, tx);
      await membershipRepository.updateRoleAssignment(input.toMembershipId, { role: "owner", roleId: ownerRole.id }, tx);

      const [fromUser, toUser] = await Promise.all([
        userRepository.findById(currentFrom.userId, tx),
        userRepository.findById(target.userId, tx),
      ]);
      await audit.recordSuccess({
        action: "organization.owner.transfer_completed",
        organizationId: input.organizationId,
        resourceType: "membership",
        resourceId: input.toMembershipId,
        resourceName: toUser?.name ?? toUser?.email ?? undefined,
        previousState: { ownerMembershipId: fromMembershipId, ownerUserId: currentFrom.userId, ownerName: fromUser?.name ?? null },
        newState: { ownerMembershipId: input.toMembershipId, ownerUserId: target.userId, ownerName: toUser?.name ?? null },
        tx,
      });

      return { fromUserId: currentFrom.userId, toUserId: target.userId };
    },
  );

  logger.info("Ownership transferred.", {
    operation: "ownership.transfer",
    organizationId: input.organizationId,
    fromMembershipId,
    toMembershipId: input.toMembershipId,
  });
  // `fromUserId`/`toUserId` — a small, additive Module 09 extension
  // (same reasoning `membership-service.ts`'s own emit sites document):
  // a notification handler needs the recipient USER ids, not just
  // membership ids, and re-querying them after this point would mean
  // trusting a second, later `membershipRepository.findById()` — a real
  // race if either membership changes again before the (in-process,
  // synchronous) event handler runs. No existing subscriber to break —
  // zero listeners registered for this event before this module.
  await events.emit("ownership.transferred", {
    organizationId: input.organizationId,
    fromMembershipId,
    toMembershipId: input.toMembershipId,
    fromUserId,
    toUserId,
  });
}

async function lockOrganizationForTransfer(tx: TenantTransactionClient, organizationId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
}
