import "server-only";
import type { Subscription, SubscriptionItem, SubscriptionStatus, PlanPrice } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export type SubscriptionWithPricedItems = Subscription & { items: (SubscriptionItem & { planPrice: PlanPrice })[] };

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

  /**
   * Module 15 — every subscription (ANY status, ANY organization) with
   * its items and each item's own `PlanPrice`, the one shape both the
   * MRR engine (`lib/billing/reporting/mrr.ts`, which itself filters to
   * the included statuses) and the MRR movement engine (`.../
   * movement.ts`, which needs canceled/historical rows too) need. Scoped
   * either to one organization (the org-level report) or platform-wide
   * (`scope: "platform"` — the caller must have already resolved
   * `resolvePlatformContext()` and opened `withTenantContext()` with
   * `isPlatformStaff: true`, exactly like every other platform-wide
   * read in this codebase — this repository method itself does no
   * authorization of its own). No status filter here — a bounded set by
   * NATURE (this platform's own live+historical subscription count, not
   * an ever-growing event log — see billing-intelligence.md
   * "Performance").
   */
  async listWithPricedItems(scope: { organizationId: string } | { platform: true }, tx: TransactionClient | typeof db = db): Promise<SubscriptionWithPricedItems[]> {
    return withDbErrorTranslation(() =>
      tx.subscription.findMany({
        where: "organizationId" in scope ? { organizationId: scope.organizationId } : {},
        include: { items: { include: { planPrice: true } } },
        orderBy: { createdAt: "asc" },
      }),
    );
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

  /**
   * Module 15 fix — an in-place Stripe item modification (e.g.
   * `changeSubscriptionPlan()`'s `stripe.subscriptions.update()` with an
   * explicit `items: [{ id: existingItemId, price: newPriceId }]`, per
   * Stripe's own "modify an existing item" shape) keeps the SAME
   * `providerItemId` — only `price`/`quantity` change. Before this fix,
   * `billing-webhook-service.ts`'s reconciliation loop treated any
   * already-linked `providerItemId` as fully settled and never called
   * this method at all, so a plan change's resulting webhook silently
   * left the local row pointing at the OLD `planPriceId` forever (a real
   * bug discovered while building Module 15's MRR engine, which reads
   * exactly this column — see billing-intelligence.md's own "bugs found"
   * section).
   */
  async update(
    id: string,
    input: { planPriceId?: string; quantity?: number },
    tx: TransactionClient | typeof db = db,
  ): Promise<SubscriptionItem> {
    return withDbErrorTranslation(() => tx.subscriptionItem.update({ where: { id }, data: input }));
  },

  async deleteById(id: string, tx: TransactionClient | typeof db = db): Promise<void> {
    await withDbErrorTranslation(() => tx.subscriptionItem.delete({ where: { id } }));
  },
};
