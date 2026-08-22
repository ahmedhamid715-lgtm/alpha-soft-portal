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
