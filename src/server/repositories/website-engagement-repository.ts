import "server-only";
import type { WebsiteEngagement } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `WebsiteEngagement` (Build 32 — Roadmap Module 26).
 * One row per `CustomerService`, forever — no archive/delete state of
 * its own (its lifecycle IS the linked CustomerService's). No DELETE
 * grant. Mirrors `localSeoEngagementRepository`/`seoEngagementRepository`
 * exactly — a THIRD, SEPARATE specialist domain, own table.
 */
export const websiteEngagementRepository = {
  async create(input: { id: string; organizationId: string; customerServiceId: string; createdByUserId: string }, tx: TransactionClient | typeof db = db): Promise<WebsiteEngagement> {
    return withDbErrorTranslation(() => tx.websiteEngagement.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<WebsiteEngagement | null> {
    return withDbErrorTranslation(() => tx.websiteEngagement.findUnique({ where: { id } }));
  },

  async findByCustomerServiceId(customerServiceId: string, tx: TransactionClient | typeof db = db): Promise<WebsiteEngagement | null> {
    return withDbErrorTranslation(() => tx.websiteEngagement.findUnique({ where: { customerServiceId } }));
  },

  async linkProject(id: string, projectId: string, tx: TransactionClient | typeof db = db): Promise<WebsiteEngagement> {
    return withDbErrorTranslation(() => tx.websiteEngagement.update({ where: { id }, data: { projectId } }));
  },
};
