import "server-only";
import type { Permission } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `Permission` — the seeded catalog
 * (`src/lib/authorization/permissions.ts` → `prisma/seed-rbac.ts`).
 * Nothing in the application ever creates a `Permission` row outside the
 * seed script — this repository's `create` exists for the seed to call,
 * not for runtime code.
 */
export const permissionRepository = {
  async create(
    input: { id: string; key: string; resource: string; action: string; scope: "PLATFORM" | "ORGANIZATION"; description?: string | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<Permission> {
    return withDbErrorTranslation(() =>
      tx.permission.create({
        data: {
          id: input.id,
          key: input.key,
          resource: input.resource,
          action: input.action,
          scope: input.scope,
          description: input.description ?? null,
        },
      }),
    );
  },

  async findByKey(key: string, tx: TransactionClient | typeof db = db): Promise<Permission | null> {
    return withDbErrorTranslation(() => tx.permission.findUnique({ where: { key } }));
  },

  async findByKeys(keys: string[], tx: TransactionClient | typeof db = db): Promise<Permission[]> {
    return withDbErrorTranslation(() => tx.permission.findMany({ where: { key: { in: keys } } }));
  },

  async list(tx: TransactionClient | typeof db = db): Promise<Permission[]> {
    return withDbErrorTranslation(() => tx.permission.findMany({ orderBy: [{ resource: "asc" }, { action: "asc" }] }));
  },
};

export const rolePermissionRepository = {
  /**
   * Replaces this role's ENTIRE permission set atomically — the shape
   * `role-service.ts`'s "update role permissions" action needs; see that
   * file for why a full-replace (not incremental add/remove calls) is
   * the safer primitive to expose. `grants` carries caller-generated
   * UUIDv7 ids (`generateId()`) — this repository never generates an id
   * itself, same convention as every other repository in this codebase.
   */
  async replaceForRole(
    roleId: string,
    grants: { id: string; permissionId: string }[],
    tx: TransactionClient,
  ): Promise<void> {
    await withDbErrorTranslation(() => tx.rolePermission.deleteMany({ where: { roleId } }));
    if (grants.length === 0) return;
    await withDbErrorTranslation(() =>
      tx.rolePermission.createMany({
        data: grants.map((grant) => ({ id: grant.id, roleId, permissionId: grant.permissionId })),
      }),
    );
  },

  /** The authorization engine's hot-path read (spec section 11/38) — every permission key a role grants, in one query. */
  async listPermissionKeysForRole(roleId: string, tx: TransactionClient | typeof db = db): Promise<string[]> {
    const rows = await withDbErrorTranslation(() =>
      tx.rolePermission.findMany({ where: { roleId }, include: { permission: { select: { key: true } } } }),
    );
    return rows.map((row) => row.permission.key);
  },
};
