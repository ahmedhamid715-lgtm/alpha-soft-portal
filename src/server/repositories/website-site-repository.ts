import "server-only";
import type { WebsiteSite, WebsiteSiteType, WebsitePlatform, WebsiteConfigurationState, WebsiteSiteStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface WebsiteSiteCreateInput {
  id: string;
  organizationId: string;
  engagementId: string;
  name: string;
  primaryUrl: string | null;
  normalizedPrimaryOrigin: string | null;
  siteType: WebsiteSiteType;
  platform: WebsitePlatform;
  technologyNotes: string | null;
  repositoryUrl: string | null;
  analyticsConfigured: WebsiteConfigurationState;
  tagManagerConfigured: WebsiteConfigurationState;
  createdByUserId: string;
}

export type WebsiteSiteUpdateInput = Partial<
  Pick<WebsiteSiteCreateInput, "name" | "primaryUrl" | "normalizedPrimaryOrigin" | "siteType" | "platform" | "technologyNotes" | "repositoryUrl" | "analyticsConfigured" | "tagManagerConfigured"> & {
    launchTargetDate: Date | null;
  }
>;

/** Data access for `WebsiteSite` (Build 32 — Roadmap Module 26). No DELETE grant — retired via `status = ARCHIVED`. Bounded to 100 per engagement (a realistic ceiling — most Website Development engagements deliver a single site). */
export const websiteSiteRepository = {
  async create(input: WebsiteSiteCreateInput, tx: TransactionClient | typeof db = db): Promise<WebsiteSite> {
    return withDbErrorTranslation(() => tx.websiteSite.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<WebsiteSite | null> {
    return withDbErrorTranslation(() => tx.websiteSite.findUnique({ where: { id } }));
  },

  async findByNormalizedOrigin(engagementId: string, normalizedPrimaryOrigin: string, tx: TransactionClient | typeof db = db): Promise<WebsiteSite | null> {
    return withDbErrorTranslation(() => tx.websiteSite.findFirst({ where: { engagementId, normalizedPrimaryOrigin } }));
  },

  async listForEngagement(engagementId: string, tx: TransactionClient | typeof db = db): Promise<WebsiteSite[]> {
    return withDbErrorTranslation(() => tx.websiteSite.findMany({ where: { engagementId }, orderBy: { createdAt: "asc" }, take: 100 }));
  },

  /** Batched across several engagements at once — never one query per engagement. */
  async listForEngagements(engagementIds: string[], tx: TransactionClient | typeof db = db): Promise<WebsiteSite[]> {
    if (engagementIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.websiteSite.findMany({ where: { engagementId: { in: engagementIds } }, orderBy: { createdAt: "asc" } }));
  },

  async update(id: string, data: WebsiteSiteUpdateInput, tx: TransactionClient | typeof db = db): Promise<WebsiteSite> {
    return withDbErrorTranslation(() => tx.websiteSite.update({ where: { id }, data }));
  },

  /** CAS-guarded on `status` currently NOT `ARCHIVED` — a lost race (already archived) returns `null`. */
  async archive(id: string, tx: TransactionClient | typeof db = db): Promise<WebsiteSite | null> {
    const result = await withDbErrorTranslation(() => tx.websiteSite.updateMany({ where: { id, status: { not: "ARCHIVED" } }, data: { status: "ARCHIVED" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.websiteSite.findUnique({ where: { id } }));
  },

  /** CAS-guarded on `status = ARCHIVED` — restores to `IN_DEVELOPMENT` (never silently back to `LAUNCHED`, which must be re-earned via a real launch record — see `reactivate()`'s own doc note). */
  async reactivate(id: string, restoreStatus: WebsiteSiteStatus, tx: TransactionClient | typeof db = db): Promise<WebsiteSite | null> {
    const result = await withDbErrorTranslation(() => tx.websiteSite.updateMany({ where: { id, status: "ARCHIVED" }, data: { status: restoreStatus } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.websiteSite.findUnique({ where: { id } }));
  },

  /** Sets the WebsiteSite `status` transition explicitly — CAS-guarded on the exact `from` status, closing a lost-update race between two concurrent lifecycle transitions. */
  async transition(id: string, from: WebsiteSiteStatus, to: WebsiteSiteStatus, tx: TransactionClient | typeof db = db): Promise<WebsiteSite | null> {
    const result = await withDbErrorTranslation(() => tx.websiteSite.updateMany({ where: { id, status: from }, data: { status: to } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.websiteSite.findUnique({ where: { id } }));
  },

  /** The launch operation itself — CAS-guarded on `status` currently NOT `LAUNCHED` (a launch is a one-time transition; re-launching an already-launched site is a no-op error, not silently repeated). */
  /** WDEV-SEC-02 (Codex Security Engineer, Build 32) — the CAS predicate excludes BOTH `LAUNCHED` (already launched) AND `ARCHIVED` (must go through `reactivate()` first) as defense-in-depth alongside the service-layer check in `recordWebsiteLaunch()`. */
  async recordLaunch(id: string, launchedAt: Date, launchDeploymentId: string | null, tx: TransactionClient | typeof db = db): Promise<WebsiteSite | null> {
    const result = await withDbErrorTranslation(() => tx.websiteSite.updateMany({ where: { id, status: { notIn: ["LAUNCHED", "ARCHIVED"] } }, data: { status: "LAUNCHED", launchedAt, launchDeploymentId } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.websiteSite.findUnique({ where: { id } }));
  },
};
