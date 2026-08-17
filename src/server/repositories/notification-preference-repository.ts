import "server-only";
import type { NotificationChannel, NotificationPreference } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `NotificationPreference` — plain `db` (or
 * `withTransaction()`), never `withTenantContext()`. This table has NO
 * RLS at all — see `docs/architecture/notifications.md`
 * "NotificationPreference — global identity data, not tenant-owned" —
 * the same category as `User`/`UserCredential`/`UserSession`. Ownership
 * is enforced by the service layer (`preference.userId === session.user.id`),
 * not by the database.
 */

export const notificationPreferenceRepository = {
  async listForUser(userId: string, tx: TransactionClient | typeof db = db): Promise<NotificationPreference[]> {
    return withDbErrorTranslation(() => tx.notificationPreference.findMany({ where: { userId } }));
  },

  async find(userId: string, category: string, channel: NotificationChannel, tx: TransactionClient | typeof db = db): Promise<NotificationPreference | null> {
    return withDbErrorTranslation(() =>
      tx.notificationPreference.findUnique({ where: { userId_category_channel: { userId, category, channel } } }),
    );
  },

  /**
   * Upsert, keyed by the same `(userId, category, channel)` uniqueness
   * the schema enforces — a user changing a toggle twice must update one
   * row, never create a second. `id` is only used on the CREATE branch;
   * an existing row keeps its original id.
   */
  async upsert(
    input: { id: string; userId: string; category: string; channel: NotificationChannel; enabled: boolean },
    tx: TransactionClient | typeof db = db,
  ): Promise<NotificationPreference> {
    return withDbErrorTranslation(() =>
      tx.notificationPreference.upsert({
        where: { userId_category_channel: { userId: input.userId, category: input.category, channel: input.channel } },
        create: input,
        update: { enabled: input.enabled },
      }),
    );
  },
};
