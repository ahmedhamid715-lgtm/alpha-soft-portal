import "server-only";
import type { GhlAutomationEngagement } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `GhlAutomationEngagement` (Build 34 — Roadmap Module
 * 28). One row per `CustomerService`, forever — no archive/delete state
 * of its own (its lifecycle IS the linked CustomerService's). No DELETE
 * grant. Mirrors `ecommerceEngagementRepository` exactly — a FIFTH,
 * SEPARATE specialist domain, own table.
 */
export const ghlEngagementRepository = {
  async create(input: { id: string; organizationId: string; customerServiceId: string; createdByUserId: string }, tx: TransactionClient | typeof db = db): Promise<GhlAutomationEngagement> {
    return withDbErrorTranslation(() => tx.ghlAutomationEngagement.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<GhlAutomationEngagement | null> {
    return withDbErrorTranslation(() => tx.ghlAutomationEngagement.findUnique({ where: { id } }));
  },

  async findByCustomerServiceId(customerServiceId: string, tx: TransactionClient | typeof db = db): Promise<GhlAutomationEngagement | null> {
    return withDbErrorTranslation(() => tx.ghlAutomationEngagement.findUnique({ where: { customerServiceId } }));
  },

  async linkProject(id: string, projectId: string, tx: TransactionClient | typeof db = db): Promise<GhlAutomationEngagement> {
    return withDbErrorTranslation(() => tx.ghlAutomationEngagement.update({ where: { id }, data: { projectId } }));
  },
};
