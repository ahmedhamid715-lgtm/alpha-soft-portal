import "server-only";
import type { User } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import {
  toOffsetPaginatedResult,
  type OffsetPaginatedResult,
  type OffsetPaginationParams,
} from "@/lib/platform/pagination";

/**
 * Data access for `User`. See organization-repository.ts's top comment for
 * the conventions this follows (no business logic, no raw-input
 * validation, `tx`-composable).
 *
 * This module intentionally has no `delete`/`deactivate`-by-hard-delete
 * function — see docs/architecture/data-modeling.md "Deletion strategy":
 * users are deactivated via `status`, never deleted. Module 04
 * (Authentication) adds the actual status-transition logic (sign-out
 * everywhere, session invalidation, ...) — this repository only exposes
 * the read/create primitives Module 03 owns.
 */

export interface CreateUserInput {
  id: string;
  /** Caller (the service layer) is responsible for lowercasing — see `normalizeEmail`. */
  email: string;
  name: string;
}

/** Postgres's `UNIQUE` on `email` is case-sensitive — normalize here, at the one boundary every write goes through, rather than adding a `citext` extension. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const userRepository = {
  async create(input: CreateUserInput, tx: TransactionClient | typeof db = db): Promise<User> {
    return withDbErrorTranslation(() =>
      tx.user.create({
        data: {
          id: input.id,
          email: normalizeEmail(input.email),
          name: input.name,
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<User | null> {
    return withDbErrorTranslation(() => tx.user.findUnique({ where: { id } }));
  },

  async findByEmail(email: string, tx: TransactionClient | typeof db = db): Promise<User | null> {
    return withDbErrorTranslation(() => tx.user.findUnique({ where: { email: normalizeEmail(email) } }));
  },

  async list(params: OffsetPaginationParams): Promise<OffsetPaginatedResult<User>> {
    const items = await withDbErrorTranslation(() =>
      db.user.findMany({
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
    );
    return toOffsetPaginatedResult(items, params);
  },

  async recordLogin(id: string, tx: TransactionClient | typeof db = db): Promise<User> {
    return withDbErrorTranslation(() =>
      tx.user.update({ where: { id }, data: { lastLoginAt: new Date(), status: "ACTIVE" } }),
    );
  },

  /**
   * Module 07 — self-service profile fields ONLY (spec section 24):
   * `name`, `avatarUrl`, `timezone`, `locale`. Deliberately cannot touch
   * `email`/`status`/`emailVerifiedAt` — those are Module 04's
   * authentication-identity fields, changed only through Module 04's own
   * mechanisms (email change would need re-verification, which doesn't
   * exist yet — see docs/architecture/user-management.md "What self-service
   * profile updates cannot touch").
   */
  async updateProfile(
    id: string,
    input: { name?: string; avatarUrl?: string | null; timezone?: string | null; locale?: string | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<User> {
    return withDbErrorTranslation(() => tx.user.update({ where: { id }, data: input }));
  },
};
