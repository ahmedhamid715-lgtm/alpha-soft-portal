import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { NotificationChannel, NotificationDelivery, NotificationDeliveryStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { toCursorPaginatedResult, type CursorPaginatedResult, type CursorPaginationParams } from "@/lib/platform/pagination";

/**
 * Data access for `NotificationDelivery`. No regular user ever reads
 * this table directly — see `docs/architecture/notifications.md`
 * "NotificationDelivery — operational, platform-observable only." Every
 * SELECT here is either the platform observability view
 * (`notifications.observability`) or the delivery/retry processor
 * (`lib/notifications/delivery.ts`), both running under platform tenant
 * context — see that file for why.
 */

export interface CreateDeliveryInput {
  id: string;
  notificationId: string;
  organizationId: string | null;
  channel: NotificationChannel;
  provider: string;
  status: NotificationDeliveryStatus;
}

export interface UpdateDeliveryInput {
  status?: NotificationDeliveryStatus;
  attemptCount?: number;
  sentAt?: Date | null;
  failedAt?: Date | null;
  nextAttemptAt?: Date | null;
  providerMessageId?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface DeliveryFilter {
  organizationId?: string;
  status?: NotificationDeliveryStatus;
  channel?: NotificationChannel;
}

export const notificationDeliveryRepository = {
  async create(input: CreateDeliveryInput, tx: TransactionClient | typeof db = db): Promise<NotificationDelivery> {
    return withDbErrorTranslation(() => tx.notificationDelivery.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<NotificationDelivery | null> {
    return withDbErrorTranslation(() => tx.notificationDelivery.findUnique({ where: { id } }));
  },

  async findByNotificationId(notificationId: string, tx: TransactionClient | typeof db = db): Promise<NotificationDelivery[]> {
    return withDbErrorTranslation(() => tx.notificationDelivery.findMany({ where: { notificationId }, orderBy: { createdAt: "asc" } }));
  },

  async update(id: string, data: UpdateDeliveryInput, tx: TransactionClient | typeof db = db): Promise<NotificationDelivery> {
    return withDbErrorTranslation(() =>
      tx.notificationDelivery.update({
        where: { id },
        data: {
          ...data,
          metadata: data.metadata === undefined ? undefined : data.metadata === null ? Prisma.JsonNull : (data.metadata as Prisma.InputJsonValue),
        },
      }),
    );
  },

  /** The retry processor's own query — everything due for another attempt right now, oldest first (fairness: don't starve an old failure behind a stream of new ones). Hard-capped by `limit`, never unbounded. */
  async findDueForRetry(limit: number, now: Date, tx: TransactionClient | typeof db = db): Promise<NotificationDelivery[]> {
    return withDbErrorTranslation(() =>
      tx.notificationDelivery.findMany({
        where: { status: "PENDING", nextAttemptAt: { lte: now } },
        orderBy: { nextAttemptAt: "asc" },
        take: limit,
      }),
    );
  },

  /** Platform observability list — cursor-paginated, same reasoning as `notificationRepository.list()`. */
  async list(
    params: CursorPaginationParams,
    filter: DeliveryFilter,
    tx: TransactionClient | typeof db = db,
  ): Promise<CursorPaginatedResult<NotificationDelivery>> {
    const where: Prisma.NotificationDeliveryWhereInput = {};
    if (filter.organizationId !== undefined) where.organizationId = filter.organizationId;
    if (filter.status) where.status = filter.status;
    if (filter.channel) where.channel = filter.channel;

    const rows = await withDbErrorTranslation(() =>
      tx.notificationDelivery.findMany({
        where,
        orderBy: { id: "desc" },
        take: params.limit + 1,
        ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      }),
    );
    return toCursorPaginatedResult(rows, params.limit, (item) => item.id);
  },
};
