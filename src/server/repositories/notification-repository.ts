import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Notification, NotificationSeverity, NotificationStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { toCursorPaginatedResult, type CursorPaginatedResult, type CursorPaginationParams } from "@/lib/platform/pagination";

/**
 * Data access for `Notification`. Thin, no business logic — see
 * `lib/notifications/service.ts` for actor/recipient resolution,
 * redaction, idempotency, and audit integration. Every write here trusts
 * its caller has already resolved a real, server-verified
 * `organizationId`/`recipientUserId` — this file never reads request
 * input directly.
 */

export interface CreateNotificationInput {
  id: string;
  organizationId: string | null;
  recipientUserId: string;
  category: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  actionUrl: string | null;
  /** Already redacted by the caller (`lib/audit/redact.ts`) — see `service.ts`. */
  metadata: Record<string, unknown> | null;
  sourceEventType: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  idempotencyKey: string;
  expiresAt: Date | null;
}

export interface NotificationFilter {
  recipientUserId?: string;
  organizationId?: string | null;
  status?: NotificationStatus;
  category?: string;
}

function whereFromFilter(filter: NotificationFilter): Prisma.NotificationWhereInput {
  const where: Prisma.NotificationWhereInput = {};
  if (filter.recipientUserId) where.recipientUserId = filter.recipientUserId;
  if (filter.organizationId !== undefined) where.organizationId = filter.organizationId;
  if (filter.status) where.status = filter.status;
  if (filter.category) where.category = filter.category;
  return where;
}

export const notificationRepository = {
  async create(input: CreateNotificationInput, tx: TransactionClient | typeof db = db): Promise<Notification> {
    return withDbErrorTranslation(() =>
      tx.notification.create({
        data: {
          ...input,
          metadata: input.metadata === null ? Prisma.JsonNull : (input.metadata as Prisma.InputJsonValue),
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<Notification | null> {
    return withDbErrorTranslation(() => tx.notification.findUnique({ where: { id } }));
  },

  async findByIdempotencyKey(idempotencyKey: string, tx: TransactionClient | typeof db = db): Promise<Notification | null> {
    return withDbErrorTranslation(() => tx.notification.findUnique({ where: { idempotencyKey } }));
  },

  /**
   * Cursor-paginated, newest first — same reasoning
   * `audit-event-repository.ts`'s own `list()` documents for why cursor,
   * not offset (`lib/platform/pagination.ts`'s own top comment names "an
   * audit log or an activity feed" as the paradigm case). `id` is a
   * UUIDv7 (time-ordered), so `ORDER BY id DESC` doubles as the sort and
   * cursor key.
   */
  async list(
    params: CursorPaginationParams,
    filter: NotificationFilter,
    tx: TransactionClient | typeof db = db,
  ): Promise<CursorPaginatedResult<Notification>> {
    const where = whereFromFilter(filter);
    const rows = await withDbErrorTranslation(() =>
      tx.notification.findMany({
        where,
        orderBy: { id: "desc" },
        take: params.limit + 1,
        ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      }),
    );
    return toCursorPaginatedResult(rows, params.limit, (item) => item.id);
  },

  async countUnread(recipientUserId: string, tx: TransactionClient | typeof db = db): Promise<number> {
    return withDbErrorTranslation(() => tx.notification.count({ where: { recipientUserId, status: "UNREAD" } }));
  },

  /**
   * `updateMany`, not `update` — returns a graceful `count: 0` (rather
   * than throwing) when `id` doesn't exist OR belongs to a different
   * recipient (RLS's `recipient_isolation_update` policy already scopes
   * this to the tenant context's own user; this `where` clause is
   * defense-in-depth at the application layer too, not a substitute for
   * it). The caller (`service.ts`) translates `count === 0` into a
   * `NotFoundError` — deliberately not `PermissionDeniedError`, so a
   * forged id for someone else's notification looks identical to a
   * nonexistent one (the same enumeration-avoidance discipline every
   * other IDOR-sensitive path in this codebase already follows).
   */
  async updateStatus(
    id: string,
    recipientUserId: string,
    data: { status: NotificationStatus; readAt?: Date | null; archivedAt?: Date | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<number> {
    const result = await withDbErrorTranslation(() =>
      tx.notification.updateMany({ where: { id, recipientUserId }, data }),
    );
    return result.count;
  },

  /** Mark every UNREAD notification for this recipient as READ — one statement, not N. */
  async markAllRead(recipientUserId: string, tx: TransactionClient | typeof db = db): Promise<number> {
    const result = await withDbErrorTranslation(() =>
      tx.notification.updateMany({
        where: { recipientUserId, status: "UNREAD" },
        data: { status: "READ", readAt: new Date() },
      }),
    );
    return result.count;
  },
};
