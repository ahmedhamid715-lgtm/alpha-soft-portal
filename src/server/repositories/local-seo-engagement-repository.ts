import "server-only";
import type { LocalSeoEngagement } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `LocalSeoEngagement` (Build 31 — Roadmap Module 25).
 * One row per `CustomerService`, forever — no archive/delete state of its
 * own (its lifecycle IS the linked CustomerService's). No DELETE grant.
 * Mirrors `seoEngagementRepository` exactly — a SEPARATE specialist
 * domain, own table.
 */
export const localSeoEngagementRepository = {
  async create(input: { id: string; organizationId: string; customerServiceId: string; createdByUserId: string }, tx: TransactionClient | typeof db = db): Promise<LocalSeoEngagement> {
    return withDbErrorTranslation(() => tx.localSeoEngagement.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoEngagement | null> {
    return withDbErrorTranslation(() => tx.localSeoEngagement.findUnique({ where: { id } }));
  },

  async findByCustomerServiceId(customerServiceId: string, tx: TransactionClient | typeof db = db): Promise<LocalSeoEngagement | null> {
    return withDbErrorTranslation(() => tx.localSeoEngagement.findUnique({ where: { customerServiceId } }));
  },
};
