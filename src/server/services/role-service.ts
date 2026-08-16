import "server-only";
import { z } from "zod";
import type { Role } from "@/generated/prisma/client";
import { generateId } from "@/lib/utils/id";
import { withTransaction } from "@/lib/db/transaction";
import { parseOrThrow } from "@/lib/validation/parse";
import { ConflictError, ValidationError, NotFoundError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging";
import { events } from "@/lib/platform/events";
import { roleRepository } from "@/server/repositories/role-repository";
import { permissionRepository, rolePermissionRepository } from "@/server/repositories/permission-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { requirePermission } from "@/lib/authorization/authorize";
import { isPermissionKey, type PermissionKey } from "@/lib/authorization/permissions";

/**
 * Role management business logic (spec section 23) — every mutating
 * operation here independently authorizes (spec section 18: "authenticate
 * → resolve authorization context → validate input → authorize →
 * execute"), never trusts that a caller already checked. This is the one
 * file every role/permission mutation in Alpha OS goes through — no
 * route or Server Action writes to `Role`/`RolePermission`/
 * `OrganizationMembership.roleId` directly.
 *
 * Domain events (spec section 32 — the audit-logging hook Module 08
 * builds on, not a second audit system): every function below emits one
 * on success, via Module 01's existing `events` bus. No listener is
 * registered yet; `events.emit()` on an unlistened name is a documented
 * no-op (see `lib/platform/events.ts`), so this costs nothing today and
 * saves Module 08 from having to retrofit call sites later.
 */

const roleKeySchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Role key must be lowercase, alphanumeric, and hyphen-separated.");

const createCustomRoleSchema = z.object({
  organizationId: z.string().uuid(),
  key: roleKeySchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  permissions: z.array(z.string()).max(200).default([]),
});

/**
 * Creates an organization-scoped custom role (spec section 5's "custom
 * roles" — an organization creating its own). System roles are never
 * created through this function; they only ever come from
 * `prisma/seed-rbac.ts` (spec section 6: "new system roles introduced
 * through controlled migrations/seeding," not a runtime API).
 */
export async function createCustomRole(rawInput: unknown): Promise<Role> {
  const input = parseOrThrow(createCustomRoleSchema, rawInput);
  await requirePermission("roles.create", input.organizationId);

  const existing = await roleRepository.findByOrganizationAndKey(input.organizationId, input.key);
  if (existing) {
    throw new ConflictError(`A role with the key "${input.key}" already exists in this organization.`, {
      details: { field: "key" },
    });
  }

  const permissionKeys = validatePermissionKeys(input.permissions);

  const role = await withTransaction(async (tx) => {
    const created = await roleRepository.create(
      {
        id: generateId(),
        organizationId: input.organizationId,
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        scope: "ORGANIZATION",
        isSystem: false,
      },
      tx,
    );

    if (permissionKeys.length > 0) {
      const permissionRows = await permissionRepository.findByKeys(permissionKeys, tx);
      await rolePermissionRepository.replaceForRole(
        created.id,
        permissionRows.map((row) => ({ id: generateId(), permissionId: row.id })),
        tx,
      );
    }

    return created;
  });

  logger.info("Custom role created.", { operation: "role.create", organizationId: input.organizationId, roleId: role.id });
  await events.emit("RoleCreated", { roleId: role.id, organizationId: input.organizationId, key: role.key });

  return role;
}

const updateRoleSchema = z.object({
  roleId: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  permissions: z.array(z.string()).max(200).optional(),
});

/**
 * Updates a custom role's name/description/permission grants. System
 * roles are unconditionally protected here (spec section 5) — checked
 * against the actual database row's `isSystem` flag, not just "does the
 * caller have permission," since even a PLATFORM_OWNER must not be able
 * to silently redefine what "owner" means for every organization at
 * once through a UI action; that's a catalog change + a seed re-run, an
 * auditable code change, not a runtime mutation.
 */
export async function updateRole(rawInput: unknown): Promise<Role> {
  const input = parseOrThrow(updateRoleSchema, rawInput);
  await requirePermission("roles.update", input.organizationId);

  const role = await roleRepository.findById(input.roleId);
  if (!role || role.organizationId !== input.organizationId) {
    throw new NotFoundError("Role");
  }
  assertNotSystemRole(role, "modified");

  const permissionKeys = input.permissions ? validatePermissionKeys(input.permissions) : null;

  const updated = await withTransaction(async (tx) => {
    const result = await roleRepository.update(
      role.id,
      { ...(input.name ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}) },
      tx,
    );

    if (permissionKeys) {
      const permissionRows = await permissionRepository.findByKeys(permissionKeys, tx);
      await rolePermissionRepository.replaceForRole(
        role.id,
        permissionRows.map((row) => ({ id: generateId(), permissionId: row.id })),
        tx,
      );
    }

    return result;
  });

  logger.info("Role updated.", { operation: "role.update", organizationId: input.organizationId, roleId: role.id });
  await events.emit("RolePermissionsChanged", { roleId: role.id, organizationId: input.organizationId });

  return updated;
}

const deleteRoleSchema = z.object({ roleId: z.string().uuid(), organizationId: z.string().uuid() });

/**
 * Deletes a custom role (spec section 26 — role deletion safety). Two
 * independent guards, not one: `isSystem` (application-level, checked
 * first for a clean error) and "still assigned to a membership"
 * (application-level pre-check for a clean error, backed by the
 * database's `onDelete: Restrict` foreign key as defense-in-depth — see
 * `schema.prisma`'s `OrganizationMembership.roleId` comment — so even a
 * bug in this pre-check cannot silently orphan a membership's role).
 */
export async function deleteRole(rawInput: unknown): Promise<void> {
  const input = parseOrThrow(deleteRoleSchema, rawInput);
  await requirePermission("roles.delete", input.organizationId);

  const role = await roleRepository.findById(input.roleId);
  if (!role || role.organizationId !== input.organizationId) {
    throw new NotFoundError("Role");
  }
  assertNotSystemRole(role, "deleted");

  const assignedCount = await roleRepository.countMemberships(role.id);
  if (assignedCount > 0) {
    throw new ConflictError(
      `This role is currently assigned to ${assignedCount} member${assignedCount === 1 ? "" : "s"} — reassign them first.`,
      { details: { assignedCount } },
    );
  }

  await roleRepository.remove(role.id);

  logger.info("Role deleted.", { operation: "role.delete", organizationId: input.organizationId, roleId: role.id });
  await events.emit("RoleDeleted", { roleId: role.id, organizationId: input.organizationId, key: role.key });
}

const assignRoleSchema = z.object({
  membershipId: z.string().uuid(),
  roleId: z.string().uuid(),
});

/**
 * Assigns a role to a membership — the single, sensitive chokepoint spec
 * section 24 requires ("authorization for role assignment must itself
 * require a privileged permission"). Every defense lives here, in one
 * place, not scattered across whatever UI action happens to call it:
 *
 *   1. **Permission gate**: `members.update` in the membership's own
 *      organization — a CUSTOMER/MEMBER/VIEWER never holds this (see
 *      `roles.ts`'s system role catalog), so section 25's escalation
 *      attempts (CUSTOMER → ADMIN, MEMBER → OWNER, ...) fail here,
 *      before anything else runs.
 *   2. **Scope compatibility**: a PLATFORM-scope role can only land on a
 *      membership inside the platform organization; an ORGANIZATION-scope
 *      role can only land inside a non-platform organization (spec
 *      section 7). This is what stops a would-be SUPPORT_AGENT →
 *      PLATFORM_ADMIN escalation even in the hypothetical where an org
 *      admin somehow held a platform-scope permission — the role itself
 *      is inadmissible outside its own scope, independent of who's
 *      assigning it.
 *   3. **Custom-role organization match**: a custom role can only be
 *      assigned within the organization that created it — one org can
 *      never assign another org's custom role.
 *   4. **Last-owner protection** (spec section 27): reassigning the
 *      organization's last `owner`-role membership away from `owner`
 *      is blocked, unconditionally, regardless of the caller's
 *      permissions — see `wouldRemoveLastOwner()`.
 */
export async function assignRole(rawInput: unknown): Promise<void> {
  const input = parseOrThrow(assignRoleSchema, rawInput);

  const membership = await membershipRepository.findById(input.membershipId);
  if (!membership) throw new NotFoundError("Membership");

  await requirePermission("members.update", membership.organizationId);

  const role = await roleRepository.findById(input.roleId);
  if (!role) throw new NotFoundError("Role");

  const organization = await organizationRepository.findById(membership.organizationId);
  if (!organization) throw new NotFoundError("Organization");

  if (role.scope === "PLATFORM" && !organization.isPlatform) {
    throw new ValidationError("A platform-scope role cannot be assigned outside the platform organization.");
  }
  if (role.scope === "ORGANIZATION" && organization.isPlatform) {
    throw new ValidationError("An organization-scope role cannot be assigned within the platform organization.");
  }
  if (!role.isSystem && role.organizationId !== membership.organizationId) {
    throw new ValidationError("A custom role can only be assigned within the organization that created it.");
  }

  if (await wouldRemoveLastOwner(membership.organizationId, membership.id, role.key)) {
    throw new ConflictError(
      "This organization would have no owner left. Assign another member as owner first.",
      { details: { reason: "last_owner" } },
    );
  }

  await membershipRepository.updateRoleAssignment(membership.id, { role: role.key, roleId: role.id });

  logger.info("Role assigned.", {
    operation: "role.assign",
    organizationId: membership.organizationId,
    membershipId: membership.id,
    roleId: role.id,
  });
  await events.emit("MembershipRoleAssigned", {
    membershipId: membership.id,
    organizationId: membership.organizationId,
    roleId: role.id,
    roleKey: role.key,
  });
  if (role.key === "owner" || role.key === "platform_owner") {
    await events.emit("OrganizationOwnerChanged", { organizationId: membership.organizationId, membershipId: membership.id });
  }
}

// --- internals ---------------------------------------------------------

function assertNotSystemRole(role: Role, verb: "modified" | "deleted"): void {
  if (role.isSystem) {
    throw new ValidationError(
      `System roles cannot be ${verb} at runtime — they are defined in src/lib/authorization/roles.ts and applied via the seed script.`,
    );
  }
}

function validatePermissionKeys(keys: string[]): PermissionKey[] {
  const invalid = keys.filter((key) => !isPermissionKey(key));
  if (invalid.length > 0) {
    throw new ValidationError("One or more permission keys are not recognized.", { details: { invalid } });
  }
  return keys as PermissionKey[];
}

/**
 * Spec section 27 — "An organization must not accidentally end up
 * without an owner." True only when ALL of: the membership being
 * changed currently holds the `owner` role, the new role is something
 * else, and it is the organization's only ACTIVE membership with the
 * `owner` role. A second owner existing (or the membership already
 * holding a different role) means this is safe. Exported — also used by
 * `membership-service.ts` for the same protection against removing or
 * suspending (not just role-reassigning) the last owner.
 */
export async function wouldRemoveLastOwner(organizationId: string, membershipId: string, newRoleKey: string): Promise<boolean> {
  if (newRoleKey === "owner") return false;

  const currentMembership = await membershipRepository.findById(membershipId);
  if (!currentMembership || currentMembership.role !== "owner") return false;

  const ownerCount = await membershipRepository.countActiveByRole(organizationId, "owner");
  return ownerCount <= 1;
}
