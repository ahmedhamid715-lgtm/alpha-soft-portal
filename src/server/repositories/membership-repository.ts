import "server-only";
import { z } from "zod";
import type { OrganizationMembership, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import {
  toOffsetPaginatedResult,
  type OffsetPaginatedResult,
  type OffsetPaginationParams,
} from "@/lib/platform/pagination";

/**
 * Data access for `OrganizationMembership` — the User↔Organization join
 * (see docs/architecture/tenancy-foundation.md for the full model).
 *
 * ## Role vocabulary — the RBAC extension point (spec section 12)
 *
 * `role` is a plain string column, not a Postgres enum and not yet a
 * foreign key to a `Role` table. `SYSTEM_MEMBERSHIP_ROLES` below is the
 * complete list this module recognizes and validates against — Module 05
 * (RBAC) is expected to either extend this list or replace it with a real
 * `Role` model (organization-defined custom roles, granular permissions).
 * A string column migrates to that cleanly (add a `Role` table keyed by
 * the same string values, then a follow-up migration turns `role` into a
 * foreign key) — a Postgres enum would not (`ALTER TYPE ... ADD VALUE`
 * can't be run inside the same transaction as other schema changes, and
 * enums can't represent org-specific custom roles at all). This is the
 * "recommended direction" the spec asks this module to document, not an
 * accident.
 */
// "support" added in Module 04 — see docs/architecture/authentication.md
// "Role-aware routing" for why: the destination-routing requirement
// (ADMIN/SUPPORT/CUSTOMER) needs a role this vocabulary didn't have yet.
// Exactly the extensibility this string-not-enum column exists for (see
// the class comment above) — no migration required.
export const SYSTEM_MEMBERSHIP_ROLES = ["owner", "admin", "support", "member"] as const;
export type SystemMembershipRole = (typeof SYSTEM_MEMBERSHIP_ROLES)[number];
export const membershipRoleSchema = z.enum(SYSTEM_MEMBERSHIP_ROLES);

export interface CreateMembershipInput {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
}

export const membershipRepository = {
  async create(input: CreateMembershipInput, tx: TransactionClient | typeof db = db): Promise<OrganizationMembership> {
    return withDbErrorTranslation(() =>
      tx.organizationMembership.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          userId: input.userId,
          role: input.role,
          joinedAt: new Date(),
        },
      }),
    );
  },

  async findByOrganizationAndUser(
    organizationId: string,
    userId: string,
    tx: TransactionClient | typeof db = db,
  ): Promise<OrganizationMembership | null> {
    return withDbErrorTranslation(() =>
      tx.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
      }),
    );
  },

  /** Every organization a user belongs to — the org-switcher query. Small result set (a person belongs to a handful of orgs at most), so unpaginated is fine. `tx` (Module 06) — see `findByOrganizationAndUser`'s comment. */
  async listForUser(
    userId: string,
    tx: TransactionClient | typeof db = db,
  ): Promise<Prisma.OrganizationMembershipGetPayload<{ include: { organization: true } }>[]> {
    return withDbErrorTranslation(() =>
      tx.organizationMembership.findMany({
        where: { userId },
        include: { organization: true },
        orderBy: { createdAt: "asc" },
      }),
    );
  },

  /**
   * An organization's member list — genuinely unbounded (an enterprise
   * org can have hundreds of members), so this one is paginated. Module
   * 07 (spec section 9) adds search/role/status filtering — still
   * always scoped to the given `organizationId` first, never a global
   * user search (spec section 32: "search must never become a global
   * user directory").
   */
  async listForOrganization(
    organizationId: string,
    params: OffsetPaginationParams,
    filter: { search?: string; role?: string; status?: Prisma.OrganizationMembershipWhereInput["status"] } = {},
    tx: TransactionClient | typeof db = db,
  ): Promise<OffsetPaginatedResult<Prisma.OrganizationMembershipGetPayload<{ include: { user: true } }>>> {
    const where: Prisma.OrganizationMembershipWhereInput = {
      organizationId,
      ...(filter.role ? { role: filter.role } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.search
        ? {
            user: {
              OR: [
                { name: { contains: filter.search, mode: "insensitive" } },
                { email: { contains: filter.search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    };
    const items = await withDbErrorTranslation(() =>
      tx.organizationMembership.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: "asc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
    );
    return toOffsetPaginatedResult(items, params);
  },

  async updateRole(id: string, role: string, tx: TransactionClient | typeof db = db): Promise<OrganizationMembership> {
    return withDbErrorTranslation(() => tx.organizationMembership.update({ where: { id }, data: { role } }));
  },

  /**
   * Module 05 (RBAC) — sets both `role` (Module 04's string, untouched
   * in meaning) and `roleId` (the real `Role` foreign key) together, in
   * one write, so they can never drift out of sync. `role-service.ts`'s
   * `assignRole()` is the only caller; nothing else should update
   * `roleId` independently — see `schema.prisma`'s field comment.
   */
  async updateRoleAssignment(
    id: string,
    input: { role: string; roleId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<OrganizationMembership> {
    return withDbErrorTranslation(() =>
      tx.organizationMembership.update({ where: { id }, data: { role: input.role, roleId: input.roleId } }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<OrganizationMembership | null> {
    return withDbErrorTranslation(() => tx.organizationMembership.findUnique({ where: { id } }));
  },

  /** How many ACTIVE memberships in this organization currently hold `role` — the last-owner-protection check (spec section 27). */
  async countActiveByRole(organizationId: string, role: string, tx: TransactionClient | typeof db = db): Promise<number> {
    return withDbErrorTranslation(() =>
      tx.organizationMembership.count({ where: { organizationId, role, status: "ACTIVE" } }),
    );
  },

  async updateStatus(
    id: string,
    status: "ACTIVE" | "SUSPENDED",
    tx: TransactionClient | typeof db = db,
  ): Promise<OrganizationMembership> {
    return withDbErrorTranslation(() => tx.organizationMembership.update({ where: { id }, data: { status } }));
  },

  /**
   * Hard delete, deliberately — unlike Organization/User, a membership row
   * has no independent historical value once revoked (see
   * data-modeling.md "Deletion strategy"). What DID happen ("X removed Y
   * from Org Z on this date") is an audit concern, not a reason to keep
   * the membership row itself around in a deleted state.
   */
  async remove(id: string, tx: TransactionClient | typeof db = db): Promise<void> {
    await withDbErrorTranslation(() => tx.organizationMembership.delete({ where: { id } }));
  },
};
