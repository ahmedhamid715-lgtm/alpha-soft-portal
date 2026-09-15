import "server-only";
import type { WebsiteEnvironment, WebsiteEnvironmentType, WebsiteEnvironmentStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface WebsiteEnvironmentUpsertData {
  url: string | null;
  normalizedOrigin: string | null;
  status: WebsiteEnvironmentStatus;
  providerLabel: string | null;
  customerVisible: boolean;
}

/**
 * Data access for `WebsiteEnvironment` (Build 32 — Roadmap Module 26) —
 * at most one row per `(siteId, type)` (real DB unique constraint).
 * `upsertForType()` is the primary write path — staff record or
 * re-record what an environment's own current state is, mirroring
 * `gbpProfileRepository`'s own exact upsert-on-real-unique-key pattern.
 * No credentials of any kind. No DELETE grant.
 */
export const websiteEnvironmentRepository = {
  async findBySiteAndType(siteId: string, type: WebsiteEnvironmentType, tx: TransactionClient | typeof db = db): Promise<WebsiteEnvironment | null> {
    return withDbErrorTranslation(() => tx.websiteEnvironment.findUnique({ where: { siteId_type: { siteId, type } } }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<WebsiteEnvironment | null> {
    return withDbErrorTranslation(() => tx.websiteEnvironment.findUnique({ where: { id } }));
  },

  async listForSite(siteId: string, tx: TransactionClient | typeof db = db): Promise<WebsiteEnvironment[]> {
    return withDbErrorTranslation(() => tx.websiteEnvironment.findMany({ where: { siteId }, orderBy: { type: "asc" } }));
  },

  /** Batched across several sites at once — never one query per site. */
  async listForSites(siteIds: string[], tx: TransactionClient | typeof db = db): Promise<WebsiteEnvironment[]> {
    if (siteIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.websiteEnvironment.findMany({ where: { siteId: { in: siteIds } } }));
  },

  async upsertForType(id: string, siteId: string, organizationId: string, type: WebsiteEnvironmentType, createdByUserId: string, data: WebsiteEnvironmentUpsertData, tx: TransactionClient | typeof db = db): Promise<WebsiteEnvironment> {
    return withDbErrorTranslation(() =>
      tx.websiteEnvironment.upsert({
        where: { siteId_type: { siteId, type } },
        create: { id, organizationId, siteId, type, createdByUserId, ...data },
        update: data,
      }),
    );
  },
};
