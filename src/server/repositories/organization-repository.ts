import "server-only";
import type { Organization, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import {
  toOffsetPaginatedResult,
  type OffsetPaginatedResult,
  type OffsetPaginationParams,
} from "@/lib/platform/pagination";

/**
 * Data access for `Organization` — the representative repository (spec
 * section 22). Every function is a thin, typed wrapper over Prisma: no
 * business logic (that's `server/services/`), no raw input validation
 * (that's the service's job via Zod — a repository trusts its caller),
 * just queries + error translation.
 *
 * Every function accepts an optional `tx` (a `TransactionClient`) so a
 * service can compose several repositories inside one `withTransaction()`
 * call — see `organization-service.ts`'s `createOrganizationWithOwner` for
 * the pattern this exists to support (spec section 21's example: "creating
 * an organization plus membership" atomically).
 */

export interface CreateOrganizationInput {
  id: string;
  name: string;
  displayName: string;
  slug: string;
  timezone?: string;
  locale?: string;
  currency?: string;
}

export const organizationRepository = {
  async create(input: CreateOrganizationInput, tx: TransactionClient | typeof db = db): Promise<Organization> {
    return withDbErrorTranslation(() =>
      tx.organization.create({
        data: {
          id: input.id,
          name: input.name,
          displayName: input.displayName,
          slug: input.slug,
          ...(input.timezone ? { timezone: input.timezone } : {}),
          ...(input.locale ? { locale: input.locale } : {}),
          ...(input.currency ? { currency: input.currency } : {}),
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<Organization | null> {
    return withDbErrorTranslation(() => tx.organization.findUnique({ where: { id } }));
  },

  /** Slug is the lookup key for subdomain/URL-based org resolution (e.g. `acme.alphaos.app` or `/org/acme`). */
  async findBySlug(slug: string, tx: TransactionClient | typeof db = db): Promise<Organization | null> {
    return withDbErrorTranslation(() => tx.organization.findUnique({ where: { slug } }));
  },

  /**
   * Module 05 (RBAC) — the one organization with `isPlatform = true`
   * (Alpha Page Rankers itself; see rbac.md "Platform vs. organization
   * scope"). `findFirst`, not `findUnique`, because the database doesn't
   * enforce "at most one platform organization" as a constraint — see
   * `Organization.isPlatform`'s schema comment for why that's a
   * deliberate service-layer invariant, not a DB one. Returns `null`
   * (never throws) if the platform organization hasn't been seeded yet —
   * callers (`context.ts`'s `resolvePlatformContext`) treat that the same
   * as "not platform staff," not an error.
   */
  async findPlatformOrganization(tx: TransactionClient | typeof db = db): Promise<Organization | null> {
    return withDbErrorTranslation(() => tx.organization.findFirst({ where: { isPlatform: true } }));
  },

  async list(
    params: OffsetPaginationParams,
    filter: { status?: Prisma.OrganizationWhereInput["status"] } = {},
  ): Promise<OffsetPaginatedResult<Organization>> {
    const where: Prisma.OrganizationWhereInput = filter.status ? { status: filter.status } : {};
    const items = await withDbErrorTranslation(() =>
      db.organization.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
    );

    // No `totalCount` — see pagination.ts: total counts are opt-in, not
    // automatic, so `hasNextPage` here uses the "got a full page" heuristic
    // rather than a COUNT(*) on every list call.
    return toOffsetPaginatedResult(items, params);
  },

  /** Organizations are archived, never deleted — see docs/architecture/data-modeling.md "Deletion strategy." */
  async archive(id: string, tx: TransactionClient | typeof db = db): Promise<Organization> {
    return withDbErrorTranslation(() =>
      tx.organization.update({
        where: { id },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      }),
    );
  },
};
