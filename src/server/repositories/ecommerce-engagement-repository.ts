import "server-only";
import type { EcommerceEngagement } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `EcommerceEngagement` (Build 33 — Roadmap Module 27).
 * One row per `CustomerService`, forever — no archive/delete state of
 * its own (its lifecycle IS the linked CustomerService's). No DELETE
 * grant. Mirrors `websiteEngagementRepository` exactly — a FOURTH,
 * SEPARATE specialist domain, own table.
 */
export const ecommerceEngagementRepository = {
  async create(input: { id: string; organizationId: string; customerServiceId: string; createdByUserId: string }, tx: TransactionClient | typeof db = db): Promise<EcommerceEngagement> {
    return withDbErrorTranslation(() => tx.ecommerceEngagement.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<EcommerceEngagement | null> {
    return withDbErrorTranslation(() => tx.ecommerceEngagement.findUnique({ where: { id } }));
  },

  async findByCustomerServiceId(customerServiceId: string, tx: TransactionClient | typeof db = db): Promise<EcommerceEngagement | null> {
    return withDbErrorTranslation(() => tx.ecommerceEngagement.findUnique({ where: { customerServiceId } }));
  },

  async linkProject(id: string, projectId: string, tx: TransactionClient | typeof db = db): Promise<EcommerceEngagement> {
    return withDbErrorTranslation(() => tx.ecommerceEngagement.update({ where: { id }, data: { projectId } }));
  },
};
