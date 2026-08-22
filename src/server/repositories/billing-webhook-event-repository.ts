import "server-only";
import { Prisma, type BillingWebhookEvent, type BillingWebhookEventStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation, translatePrismaError } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `BillingWebhookEvent` — deliberately the plain `db`
 * client throughout, never `withTenantContext()` (this table has no
 * RLS at all — see its own doc comment in schema.prisma and
 * billing-webhooks.md "Why this table has no RLS"). The webhook route
 * handler that's the primary caller has no user session/tenant context
 * to set in the first place.
 */
export const billingWebhookEventRepository = {
  async findByProviderEventId(provider: "STRIPE", providerEventId: string, tx: TransactionClient | typeof db = db): Promise<BillingWebhookEvent | null> {
    return withDbErrorTranslation(() => tx.billingWebhookEvent.findUnique({ where: { provider_providerEventId: { provider, providerEventId } } }));
  },

  /**
   * The idempotency insert (spec §18) — a real `UNIQUE(provider,
   * providerEventId)` constraint (see migration) is the actual
   * guarantee; this method just surfaces a clean `null` return on a
   * duplicate rather than letting `billing-webhook-service.ts` catch a
   * raw Prisma unique-constraint error. Two CONCURRENT deliveries of the
   * same event can both reach this call — only one INSERT can ever
   * succeed, proven with a real concurrency test
   * (`billing-webhook-concurrency.test.ts`), not just reasoned about.
   */
  async tryInsert(
    input: { id: string; provider: "STRIPE"; providerEventId: string; eventType: string; payload: Record<string, unknown> },
    tx: TransactionClient | typeof db = db,
  ): Promise<BillingWebhookEvent | null> {
    try {
      return await tx.billingWebhookEvent.create({
        data: { id: input.id, provider: input.provider, providerEventId: input.providerEventId, eventType: input.eventType, payload: input.payload as Prisma.InputJsonValue },
      });
    } catch (error) {
      const prismaError = error as { code?: string };
      if (prismaError.code === "P2002") return null; // duplicate — the other delivery won the race
      throw translatePrismaError(error);
    }
  },

  async markProcessed(id: string, tx: TransactionClient | typeof db = db): Promise<void> {
    await withDbErrorTranslation(() => tx.billingWebhookEvent.update({ where: { id }, data: { status: "PROCESSED", processedAt: new Date() } }));
  },

  async markFailed(id: string, error: string, tx: TransactionClient | typeof db = db): Promise<void> {
    await withDbErrorTranslation(() => tx.billingWebhookEvent.update({ where: { id }, data: { status: "FAILED", error, processedAt: new Date() } }));
  },

  async markIgnored(id: string, tx: TransactionClient | typeof db = db): Promise<void> {
    await withDbErrorTranslation(() => tx.billingWebhookEvent.update({ where: { id }, data: { status: "IGNORED", processedAt: new Date() } }));
  },

  /** Platform observability only (spec §24/§47) — bounded, most-recent-first. */
  async listRecent(limit: number, filter: { status?: BillingWebhookEventStatus } = {}, tx: TransactionClient | typeof db = db): Promise<BillingWebhookEvent[]> {
    return withDbErrorTranslation(() =>
      tx.billingWebhookEvent.findMany({ where: filter, orderBy: { receivedAt: "desc" }, take: limit }),
    );
  },

  /** Module 15 — counts per status, the control center's own "N failed, N pending" tiles. Cheap (a single indexed aggregate over a table this codebase already keeps bounded via normal operation, not a full scan of unbounded history — see billing-financial-controls.md "Performance"). */
  async countByStatus(tx: TransactionClient | typeof db = db): Promise<Record<BillingWebhookEventStatus, number>> {
    const rows = await withDbErrorTranslation(() => tx.billingWebhookEvent.groupBy({ by: ["status"], _count: { _all: true } }));
    const counts: Record<BillingWebhookEventStatus, number> = { PENDING: 0, PROCESSED: 0, FAILED: 0, IGNORED: 0 };
    for (const row of rows) counts[row.status] = row._count._all;
    return counts;
  },

  /** Module 15 — the single most recent event of ANY status, regardless of `filter` — the "last webhook received: N minutes ago" freshness signal the control center uses as a cheap, local proxy for "is Stripe actually reaching us," without making a live provider API call. */
  async findMostRecent(tx: TransactionClient | typeof db = db): Promise<BillingWebhookEvent | null> {
    return withDbErrorTranslation(() => tx.billingWebhookEvent.findFirst({ orderBy: { receivedAt: "desc" } }));
  },
};
