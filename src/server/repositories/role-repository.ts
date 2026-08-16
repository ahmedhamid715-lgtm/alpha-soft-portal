import "server-only";
import type { Role, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `Role` — see prisma/schema.prisma's model comment and
 * docs/architecture/rbac.md for the full model. Same conventions as
 * every other repository in this codebase: no business logic (that's
 * `role-service.ts`), no input validation, `tx`-composable.
 */

export interface CreateRoleInput {
  id: string;
  /** Null for a system role; set for a custom, organization-scoped role. */
  organizationId: string | null;
  key: string;
  name: string;
  description?: string | null;
  scope: "PLATFORM" | "ORGANIZATION";
  isSystem?: boolean;
}

export const roleRepository = {
  async create(input: CreateRoleInput, tx: TransactionClient | typeof db = db): Promise<Role> {
    return withDbErrorTranslation(() =>
      tx.role.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          scope: input.scope,
          isSystem: input.isSystem ?? false,
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<Role | null> {
    return withDbErrorTranslation(() => tx.role.findUnique({ where: { id } }));
  },

  /** System role lookup — `organizationId` is always null for these, so `key` alone is the real identity (see the partial unique index this depends on). */
  async findSystemRoleByKey(key: string, tx: TransactionClient | typeof db = db): Promise<Role | null> {
    return withDbErrorTranslation(() =>
      tx.role.findFirst({ where: { key, organizationId: null } }),
    );
  },

  async findByOrganizationAndKey(
    organizationId: string,
    key: string,
    tx: TransactionClient | typeof db = db,
  ): Promise<Role | null> {
    return withDbErrorTranslation(() =>
      tx.role.findUnique({ where: { organizationId_key: { organizationId, key } } }),
    );
  },

  /** Every system role (global, `organizationId = null`) — the base set every organization can assign from. */
  async listSystemRoles(tx: TransactionClient | typeof db = db): Promise<Role[]> {
    return withDbErrorTranslation(() =>
      tx.role.findMany({ where: { organizationId: null }, orderBy: { name: "asc" } }),
    );
  },

  /** System roles plus this organization's own custom roles — what a role-picker for this org should offer. */
  async listAvailableForOrganization(organizationId: string, tx: TransactionClient | typeof db = db): Promise<Role[]> {
    return withDbErrorTranslation(() =>
      tx.role.findMany({
        where: { OR: [{ organizationId: null }, { organizationId }] },
        orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      }),
    );
  },

  async listWithPermissions(
    where: Prisma.RoleWhereInput,
    tx: TransactionClient | typeof db = db,
  ): Promise<Prisma.RoleGetPayload<{ include: { rolePermissions: { include: { permission: true } } } }>[]> {
    return withDbErrorTranslation(() =>
      tx.role.findMany({
        where,
        include: { rolePermissions: { include: { permission: true } } },
        orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      }),
    );
  },

  async update(
    id: string,
    data: { name?: string; description?: string | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<Role> {
    return withDbErrorTranslation(() => tx.role.update({ where: { id }, data }));
  },

  /** Hard delete — see role-service.ts for the safety checks (system-role protection, "still assigned" check) that must run before this is ever called. This function trusts its caller, same as every other repository. */
  async remove(id: string, tx: TransactionClient | typeof db = db): Promise<void> {
    await withDbErrorTranslation(() => tx.role.delete({ where: { id } }));
  },

  /** How many memberships currently hold this role — role-service.ts's "can't delete an assigned role" check (spec section 26), and available to the UI to explain *why* a delete is blocked. */
  async countMemberships(roleId: string, tx: TransactionClient | typeof db = db): Promise<number> {
    return withDbErrorTranslation(() => tx.organizationMembership.count({ where: { roleId } }));
  },
};
