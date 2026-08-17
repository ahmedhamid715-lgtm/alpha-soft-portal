import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { User, UserStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import {
  toCursorPaginatedResult,
  toOffsetPaginatedResult,
  type CursorPaginatedResult,
  type CursorPaginationParams,
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

  /**
   * Module 10 — the platform-wide user directory's own query
   * (`user-management-service.ts:listUsers()`). Cursor-paginated, newest
   * first — same "an audit log or an activity feed" reasoning
   * `pagination.ts` already documents applies here too: a platform user
   * directory grows unbounded over the platform's lifetime, so offset
   * pagination (spec section 19's own explicit prohibition) would get
   * slower with every page as the dataset grows. `id` is a UUIDv7
   * (time-ordered), so `ORDER BY id DESC` doubles as "newest first" and
   * the cursor key, identical to every other cursor list in this
   * codebase (`notification-repository.ts`, `audit-event-repository.ts`).
   *
   * Deliberately does NOT support arbitrary column sort (name/email/
   * lastLogin — spec section 1's own wishlist) — see
   * `docs/architecture/user-management.md` "Directory performance" for
   * why: a real compound keyset cursor per sortable column is
   * meaningfully more machinery than this module's actual need
   * justifies today, and the spec's own HARD requirement (section 19:
   * "do not use offset pagination for large user lists") takes priority
   * over the sort-order wishlist when the two are in tension. `search`
   * matches name OR email (case-insensitive substring) — the same
   * "don't silently miss an email substring" fix Module 07's own member
   * directory needed (see `organization-management.md`).
   */
  async search(
    params: CursorPaginationParams,
    filter: { search?: string; status?: UserStatus; emailVerified?: boolean } = {},
  ): Promise<CursorPaginatedResult<User>> {
    const where: Prisma.UserWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.emailVerified !== undefined ? { emailVerifiedAt: filter.emailVerified ? { not: null } : null } : {}),
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: "insensitive" } },
              { email: { contains: filter.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const rows = await withDbErrorTranslation(() =>
      db.user.findMany({
        where,
        orderBy: { id: "desc" },
        take: params.limit + 1,
        ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      }),
    );
    return toCursorPaginatedResult(rows, params.limit, (item) => item.id);
  },

  /**
   * The global account-status transition (spec sections 5/6/7) — ACTIVE
   * ⇄ SUSPENDED, and → DEACTIVATED. Distinct from `updateProfile()`
   * above: a status write is a security-relevant mutation
   * (`getCurrentUser()` checks it on every request — see
   * `lib/auth/session-guard.ts`), never bundled into a profile-field
   * update. The caller (`user-management-service.ts`) is responsible for
   * every state-transition/permission/last-owner rule; this is a plain
   * write.
   */
  async updateStatus(id: string, status: UserStatus, tx: TransactionClient | typeof db = db): Promise<User> {
    return withDbErrorTranslation(() => tx.user.update({ where: { id }, data: { status } }));
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
