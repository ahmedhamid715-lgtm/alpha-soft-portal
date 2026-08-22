import "server-only";
import type { Subscription, SubscriptionItem, SubscriptionStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Data access for `Subscription`/`SubscriptionItem` — RLS-protected (organization-owned / transitively organization-owned); every call must run inside `withTenantContext()`. */
export const subscriptionRepository = {
  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<Subscription | null> {
    return withDbErrorTranslation(() => tx.subscription.findUnique({ where: { id } }));
  },

  async findByProviderSubscriptionId(provider: "STRIPE", providerSubscriptionId: string, tx: TransactionClient | typeof db = db): Promise<Subscription | null> {
    return withDbErrorTranslation(() => tx.subscription.findUnique({ where: { provider_providerSubscriptionId: { provider, providerSubscriptionId } } }));
  },

  /** The organization's current (most recently created) subscription, of any status — most callers want this, not a full history. */
  async findCurrentForOrganization(organizationId: string, tx: TransactionClient | typeof db = db): Promise<Subscription | null> {
    return withDbErrorTranslation(() => tx.subscription.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } }));
  },

  /**
   * The organization's current subscription, row-LOCKED for the
   * duration of the caller's transaction (Module 14 spec §4/§17: "every
   * subscription mutation must re-read current server state... use row
   * locking where appropriate"). MUST be called inside a transaction
   * (`withTenantContext()`'s own `tx`) — a lock acquired outside one
   * releases immediately and protects nothing. Two concurrent callers
   * racing to mutate the SAME organization's subscription serialize
   * here: the second caller's `SELECT ... FOR UPDATE` blocks until the
   * first transaction commits or rolls back, so it always re-reads the
   * FIRST caller's already-applied state, never a stale snapshot from
   * before it. Proven under real concurrency, not just reasoned about
   * — see `subscription-concurrency.test.ts`.
   */
  async findCurrentForOrganizationLocked(organizationId: string, tx: TransactionClient): Promise<Subscription | null> {
    // Two queries, deliberately: `$queryRaw` returns raw snake_case
    // columns, not the Prisma Client's mapped camelCase shape — so the
    // raw query is used ONLY to acquire the lock (selecting just the
    // id), and the actual row is then read back through the normal,
    // correctly-typed Prisma Client call. Both run inside the SAME
    // transaction, so the second read is guaranteed consistent with
    // the row the first query just locked — no window for another
    // transaction to change it in between.
    const locked = await withDbErrorTranslation(() =>
      tx.$queryRaw<{ id: string }[]>`SELECT id FROM subscriptions WHERE organization_id = ${organizationId}::uuid ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    );
    if (!locked[0]) return null;
    return withDbErrorTranslation(() => tx.subscription.findUnique({ where: { id: locked[0]!.id } }));
  },

  async listForOrganization(organizationId: string, tx: TransactionClient | typeof db = db): Promise<Subscription[]> {
    return withDbErrorTranslation(() => tx.subscription.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } }));
  },

  async create(
    input: {
      id: string;
      organizationId: string;
      billingAccountId: string;
      provider: "STRIPE";
      providerSubscriptionId?: string;
      status?: SubscriptionStatus;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<Subscription> {
    return withDbErrorTranslation(() =>
      tx.subscription.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          billingAccountId: input.billingAccountId,
          provider: input.provider,
          providerSubscriptionId: input.providerSubscriptionId ?? null,
          status: input.status ?? "INCOMPLETE",
        },
      }),
    );
  },

  /**
   * Reconciles webhook-observed subscription state onto the row — the
   * one write path `billing-webhook-service.ts` uses. `eventTimestamp`
   * is compared against the row's own `providerEventTimestamp` by the
   * CALLER before this is invoked (see that service's own out-of-order
   * guard) — this method just performs the write once the caller has
   * already decided it's safe to apply.
   */
  async applyProviderState(
    id: string,
    input: {
      status: SubscriptionStatus;
      currentPeriodStart: Date | null;
      currentPeriodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
      canceledAt: Date | null;
      trialStart: Date | null;
      trialEnd: Date | null;
      providerEventTimestamp: Date;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<Subscription> {
    return withDbErrorTranslation(() => tx.subscription.update({ where: { id }, data: input }));
  },

  async setCancelAtPeriodEnd(id: string, cancelAtPeriodEnd: boolean, tx: TransactionClient | typeof db = db): Promise<Subscription> {
    return withDbErrorTranslation(() => tx.subscription.update({ where: { id }, data: { cancelAtPeriodEnd } }));
  },
};

export const subscriptionItemRepository = {
  async listForSubscription(subscriptionId: string, tx: TransactionClient | typeof db = db): Promise<SubscriptionItem[]> {
    return withDbErrorTranslation(() => tx.subscriptionItem.findMany({ where: { subscriptionId } }));
  },

  async findByProviderItemId(provider: "STRIPE", providerItemId: string, tx: TransactionClient | typeof db = db): Promise<SubscriptionItem | null> {
    return withDbErrorTranslation(() => tx.subscriptionItem.findUnique({ where: { provider_providerItemId: { provider, providerItemId } } }));
  },

  async create(
    input: { id: string; subscriptionId: string; planPriceId: string; quantity: number; provider: "STRIPE"; providerItemId?: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<SubscriptionItem> {
    return withDbErrorTranslation(() =>
      tx.subscriptionItem.create({
        data: {
          id: input.id,
          subscriptionId: input.subscriptionId,
          planPriceId: input.planPriceId,
          quantity: input.quantity,
          provider: input.provider,
          providerItemId: input.providerItemId ?? null,
        },
      }),
    );
  },

  async deleteById(id: string, tx: TransactionClient | typeof db = db): Promise<void> {
    await withDbErrorTranslation(() => tx.subscriptionItem.delete({ where: { id } }));
  },
};
