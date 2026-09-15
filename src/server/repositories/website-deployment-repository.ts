import "server-only";
import type { WebsiteDeployment, WebsiteDeploymentStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface WebsiteDeploymentCreateInput {
  id: string;
  organizationId: string;
  siteId: string;
  environmentId: string;
  deployedAt: Date;
  status: WebsiteDeploymentStatus;
  versionLabel: string | null;
  notes: string | null;
  rollbackOfDeploymentId: string | null;
  createdByUserId: string;
}

/**
 * Data access for `WebsiteDeployment` (Build 32 — Roadmap Module 26) —
 * pure append-only historical evidence. No UPDATE/DELETE grant at all
 * (revoked at the DB level, no RLS UPDATE policy either — see the
 * migration). Every method here is create/read only, mirroring
 * `localRankObservationRepository`'s own exact append-only discipline.
 */
export const websiteDeploymentRepository = {
  async create(input: WebsiteDeploymentCreateInput, tx: TransactionClient | typeof db = db): Promise<WebsiteDeployment> {
    return withDbErrorTranslation(() => tx.websiteDeployment.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<WebsiteDeployment | null> {
    return withDbErrorTranslation(() => tx.websiteDeployment.findUnique({ where: { id } }));
  },

  /** Most recent deployments first for a site — bounded, for the site's own deployment-history view. */
  async listForSite(siteId: string, limit: number, tx: TransactionClient | typeof db = db): Promise<WebsiteDeployment[]> {
    return withDbErrorTranslation(() => tx.websiteDeployment.findMany({ where: { siteId }, orderBy: { deployedAt: "desc" }, take: Math.min(limit, 200) }));
  },

  /** The single most recent deployment for a site (any environment) — used for a "latest deployment" summary without fetching full history. */
  async findLatestForSite(siteId: string, tx: TransactionClient | typeof db = db): Promise<WebsiteDeployment | null> {
    return withDbErrorTranslation(() => tx.websiteDeployment.findFirst({ where: { siteId }, orderBy: { deployedAt: "desc" } }));
  },

  /** Batched across several sites at once — the single most recent deployment per site, via a `DISTINCT ON`-equivalent LATERAL join. Never one query per site. */
  async listLatestForSites(siteIds: string[], tx: TransactionClient | typeof db = db): Promise<Array<{ siteId: string; deployment: WebsiteDeployment }>> {
    if (siteIds.length === 0) return [];
    const rows = await withDbErrorTranslation(() =>
      tx.$queryRaw<
        Array<{
          site_id: string;
          id: string;
          organization_id: string;
          environment_id: string;
          deployed_at: Date;
          status: WebsiteDeploymentStatus;
          version_label: string | null;
          notes: string | null;
          rollback_of_deployment_id: string | null;
          created_by_user_id: string;
          created_at: Date;
        }>
      >`
        SELECT requested.site_id, latest.*
        FROM unnest(${siteIds}::uuid[]) AS requested(site_id)
        CROSS JOIN LATERAL (
          SELECT id, organization_id, environment_id, deployed_at, status, version_label, notes, rollback_of_deployment_id, created_by_user_id, created_at
          FROM website_deployments
          WHERE site_id = requested.site_id
          ORDER BY deployed_at DESC
          LIMIT 1
        ) AS latest
      `,
    );
    return rows.map((r) => ({
      siteId: r.site_id,
      deployment: {
        id: r.id,
        organizationId: r.organization_id,
        siteId: r.site_id,
        environmentId: r.environment_id,
        deployedAt: r.deployed_at,
        status: r.status,
        versionLabel: r.version_label,
        notes: r.notes,
        rollbackOfDeploymentId: r.rollback_of_deployment_id,
        createdByUserId: r.created_by_user_id,
        createdAt: r.created_at,
      },
    }));
  },
};
