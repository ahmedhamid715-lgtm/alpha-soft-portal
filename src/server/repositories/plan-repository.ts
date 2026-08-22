import "server-only";
import { Prisma, type Plan, type PlanPrice } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `Plan`/`PlanPrice` — deliberately NOT RLS-protected
 * (see billing-data-model.md "Plan catalog — platform-wide reference
 * data") — a plain `db` client throughout, same as `organizationRepository`'s
 * own reads of the `organizations` table itself.
 */
export const planRepository = {
  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<Plan | null> {
    return withDbErrorTranslation(() => tx.plan.findUnique({ where: { id } }));
  },

  async findByKey(key: string, tx: TransactionClient | typeof db = db): Promise<Plan | null> {
    return withDbErrorTranslation(() => tx.plan.findUnique({ where: { key } }));
  },

  /** Every plan, active or not — platform admin's own catalog view. */
  async listAll(tx: TransactionClient | typeof db = db): Promise<Plan[]> {
    return withDbErrorTranslation(() => tx.plan.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }));
  },

  /** Active plans with at least one active price — the customer-facing catalog. */
  async listActiveWithActivePrices(tx: TransactionClient | typeof db = db): Promise<Array<Plan & { prices: PlanPrice[] }>> {
    return withDbErrorTranslation(() =>
      tx.plan.findMany({
        where: { active: true },
        include: { prices: { where: { active: true }, orderBy: { unitAmount: "asc" } } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
    );
  },

  async create(
    input: { id: string; key: string; name: string; description?: string; sortOrder?: number; metadata?: Record<string, unknown> },
    tx: TransactionClient | typeof db = db,
  ): Promise<Plan> {
    return withDbErrorTranslation(() =>
      tx.plan.create({
        data: {
          id: input.id,
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          sortOrder: input.sortOrder ?? 0,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      }),
    );
  },

  async update(
    id: string,
    input: Partial<{ name: string; description: string | null; active: boolean; sortOrder: number; metadata: Record<string, unknown> | null }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<Plan> {
    const { metadata, ...rest } = input;
    return withDbErrorTranslation(() =>
      tx.plan.update({
        where: { id },
        data: { ...rest, ...(metadata !== undefined ? { metadata: metadata === null ? Prisma.JsonNull : (metadata as Prisma.InputJsonValue) } : {}) },
      }),
    );
  },
};

export const planPriceRepository = {
  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<PlanPrice | null> {
    return withDbErrorTranslation(() => tx.planPrice.findUnique({ where: { id } }));
  },

  async findByProviderPriceId(provider: "STRIPE", providerPriceId: string, tx: TransactionClient | typeof db = db): Promise<PlanPrice | null> {
    return withDbErrorTranslation(() => tx.planPrice.findUnique({ where: { provider_providerPriceId: { provider, providerPriceId } } }));
  },

  async listForPlan(planId: string, tx: TransactionClient | typeof db = db): Promise<PlanPrice[]> {
    return withDbErrorTranslation(() => tx.planPrice.findMany({ where: { planId }, orderBy: { unitAmount: "asc" } }));
  },

  async create(
    input: {
      id: string;
      planId: string;
      nickname?: string;
      currency: string;
      unitAmount: number;
      interval: "MONTH" | "YEAR";
      provider: "STRIPE";
      providerPriceId?: string;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<PlanPrice> {
    return withDbErrorTranslation(() =>
      tx.planPrice.create({
        data: {
          id: input.id,
          planId: input.planId,
          nickname: input.nickname ?? null,
          currency: input.currency,
          unitAmount: input.unitAmount,
          interval: input.interval,
          provider: input.provider,
          providerPriceId: input.providerPriceId ?? null,
        },
      }),
    );
  },

  async update(
    id: string,
    input: Partial<{ nickname: string | null; active: boolean; providerPriceId: string | null }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<PlanPrice> {
    return withDbErrorTranslation(() => tx.planPrice.update({ where: { id }, data: input }));
  },
};
