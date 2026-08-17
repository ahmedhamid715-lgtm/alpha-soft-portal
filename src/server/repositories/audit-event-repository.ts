import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { AuditEvent, AuditActorType, AuditCategory, AuditOutcome } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { toCursorPaginatedResult, type CursorPaginatedResult, type CursorPaginationParams } from "@/lib/platform/pagination";

/**
 * Data access for `AuditEvent` (Module 08). **Deliberately exports no
 * `update`/`delete` function of any kind** — this is the
 * application-layer half of "append-only" (the database-privilege half
 * is the `REVOKE UPDATE, DELETE ... FROM alpha_os_app` in
 * `20260818090000_audit_system`'s migration; see
 * `docs/architecture/audit-security.md` for why neither half alone is
 * the whole story). Every other repository in this codebase follows the
 * "thin, no business logic, tx-composable" convention — this one adds
 * one more rule: **the shape of this file itself is a security control**,
 * not just a style choice.
 */

export interface CreateAuditEventInput {
  id: string;
  organizationId: string | null;
  actorType: AuditActorType;
  actorUserId: string | null;
  actorServiceId: string | null;
  actorDisplayName: string | null;
  action: string;
  category: AuditCategory;
  outcome: AuditOutcome;
  resourceType: string | null;
  resourceId: string | null;
  resourceName: string | null;
  /**
   * Already redacted by the caller (`lib/audit/redact.ts`) before this
   * repository ever sees it. Typed as a plain `Record`, not
   * `Prisma.InputJsonValue` — the redaction output is a deep-cloned plain
   * object/array/primitive tree, always JSON-safe in practice, but not
   * structurally provable to TS without an unsound recursive type; `create()`
   * below is the one place that bridges to Prisma's own JSON input type.
   */
  previousState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string;
  correlationId: string;
}

export interface AuditEventFilter {
  organizationId?: string | null;
  organizationIdIn?: (string | null)[];
  actorUserId?: string;
  action?: string;
  category?: AuditCategory;
  outcome?: AuditOutcome;
  resourceType?: string;
  resourceId?: string;
  requestId?: string;
  correlationId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  /** Matches against `action`, `resourceName`, `actorDisplayName` — see `query.ts`'s own scoping of when this is safe to accept from a client-supplied filter. */
  search?: string;
}

function whereFromFilter(filter: AuditEventFilter): Prisma.AuditEventWhereInput {
  const and: Prisma.AuditEventWhereInput[] = [];

  if (filter.organizationId !== undefined) and.push({ organizationId: filter.organizationId });
  if (filter.organizationIdIn) {
    // `IN` cannot match a NULL column (SQL: `col IN (NULL)` is never
    // TRUE) — split into an explicit `organizationId: null` branch plus
    // an `in` branch for the real ids, same shape `listPlatformAuditEvents()`
    // in `query.ts` needs (`[null, platformOrgId]`).
    const nonNull = filter.organizationIdIn.filter((id): id is string => id !== null);
    const includesNull = filter.organizationIdIn.includes(null);
    const branches: Prisma.AuditEventWhereInput[] = [];
    if (includesNull) branches.push({ organizationId: null });
    if (nonNull.length > 0) branches.push({ organizationId: { in: nonNull } });
    and.push(branches.length > 0 ? { OR: branches } : { organizationId: { in: [] } });
  }
  if (filter.actorUserId) and.push({ actorUserId: filter.actorUserId });
  if (filter.action) and.push({ action: filter.action });
  if (filter.category) and.push({ category: filter.category });
  if (filter.outcome) and.push({ outcome: filter.outcome });
  if (filter.resourceType) and.push({ resourceType: filter.resourceType });
  if (filter.resourceId) and.push({ resourceId: filter.resourceId });
  if (filter.requestId) and.push({ requestId: filter.requestId });
  if (filter.correlationId) and.push({ correlationId: filter.correlationId });
  if (filter.createdAfter || filter.createdBefore) {
    and.push({
      createdAt: {
        ...(filter.createdAfter ? { gte: filter.createdAfter } : {}),
        ...(filter.createdBefore ? { lte: filter.createdBefore } : {}),
      },
    });
  }
  if (filter.search) {
    and.push({
      OR: [
        { action: { contains: filter.search, mode: "insensitive" } },
        { resourceName: { contains: filter.search, mode: "insensitive" } },
        { actorDisplayName: { contains: filter.search, mode: "insensitive" } },
      ],
    });
  }

  return and.length > 0 ? { AND: and } : {};
}

export const auditEventRepository = {
  async create(input: CreateAuditEventInput, tx: TransactionClient | typeof db = db): Promise<AuditEvent> {
    // Prisma's nullable-Json input type has no direct `null` — an
    // explicit "store SQL NULL" is `Prisma.JsonNull`, distinct from
    // `Prisma.DbNull`/omitting the field. See prisma/schema.prisma's
    // `AuditEvent.previousState` comment.
    return withDbErrorTranslation(() =>
      tx.auditEvent.create({
        data: {
          ...input,
          previousState: input.previousState === null ? Prisma.JsonNull : (input.previousState as Prisma.InputJsonValue),
          newState: input.newState === null ? Prisma.JsonNull : (input.newState as Prisma.InputJsonValue),
          metadata: input.metadata === null ? Prisma.JsonNull : (input.metadata as Prisma.InputJsonValue),
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<AuditEvent | null> {
    return withDbErrorTranslation(() => tx.auditEvent.findUnique({ where: { id } }));
  },

  /**
   * Paginated, filtered list — newest first, **cursor**-based, not
   * offset. `lib/platform/pagination.ts`'s own top comment names "an
   * audit log or an activity feed" as the paradigm case for cursor over
   * offset pagination — an append-only, high-insert-rate table is
   * exactly where `OFFSET n` skips or duplicates rows as new events land
   * between two page loads; a cursor never does, because it's anchored
   * to a real row, not a row count.
   *
   * The cursor is a row's own `id` — deliberately not a
   * `(createdAt, id)` composite. Every id here is a UUIDv7
   * (`lib/utils/id.ts`), whose first 48 bits are a millisecond
   * timestamp, so `id DESC` and `createdAt DESC` already agree closely
   * enough for a "recent activity" feed (ties within the same
   * millisecond break on the id's own trailing random bits, which is
   * still stable and monotonic — the actual property cursor pagination
   * needs) — a single scalar cursor instead of a composite one, on a
   * column that's already the primary key's own unique index.
   *
   * `filter` is trusted input (the service layer has already
   * resolved/validated it, in particular `organizationId`/
   * `organizationIdIn`, which are NEVER built from raw client input —
   * see `query.ts`).
   */
  async list(
    params: CursorPaginationParams,
    filter: AuditEventFilter = {},
    tx: TransactionClient | typeof db = db,
  ): Promise<CursorPaginatedResult<AuditEvent>> {
    const where = whereFromFilter(filter);
    const rows = await withDbErrorTranslation(() =>
      tx.auditEvent.findMany({
        where,
        orderBy: { id: "desc" },
        take: params.limit + 1,
        ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      }),
    );
    return toCursorPaginatedResult(rows, params.limit, (item) => item.id);
  },

  /** Unbounded by pagination but hard-capped by `maxRows` — the export path only, never the list UI. See `query.ts`'s `exportAuditEvents()`. */
  async listForExport(filter: AuditEventFilter, maxRows: number, tx: TransactionClient | typeof db = db): Promise<AuditEvent[]> {
    const where = whereFromFilter(filter);
    return withDbErrorTranslation(() =>
      tx.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: maxRows }),
    );
  },
};
