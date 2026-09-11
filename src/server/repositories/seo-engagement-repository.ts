import "server-only";
import type { SeoEngagement } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `SeoEngagement` (Build 30 — Roadmap Module 24). One
 * row per `CustomerService`, forever — no archive/delete state of its
 * own (its lifecycle IS the linked CustomerService's). No DELETE grant.
 */
export const seoEngagementRepository = {
  async create(input: { id: string; organizationId: string; customerServiceId: string; createdByUserId: string }, tx: TransactionClient | typeof db = db): Promise<SeoEngagement> {
    return withDbErrorTranslation(() => tx.seoEngagement.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<SeoEngagement | null> {
    return withDbErrorTranslation(() => tx.seoEngagement.findUnique({ where: { id } }));
  },

  async findByCustomerServiceId(customerServiceId: string, tx: TransactionClient | typeof db = db): Promise<SeoEngagement | null> {
    return withDbErrorTranslation(() => tx.seoEngagement.findUnique({ where: { customerServiceId } }));
  },
};
