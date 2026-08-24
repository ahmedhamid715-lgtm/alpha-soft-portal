import "server-only";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";

/**
 * Platform-wide knowledge/ingestion observability (Module 18) —
 * `knowledge.observability`, mirroring Module 17's own
 * `getPlatformAiUsageSummary()` shape: operational metadata across
 * every organization, never a grant of any one organization's actual
 * document CONTENT (no chunk/version content anywhere in this file's
 * output types — only counts and status breakdowns).
 *
 * **Honest limitation, not an oversight**: this reports real,
 * DURABLE-table-derived signals (source/document counts, ingestion
 * status breakdown — genuinely useful for "is ingestion healthy,
 * how much knowledge exists") — it does NOT report per-retrieval-call
 * volume/latency, because this module deliberately does not log every
 * individual retrieval query (the same "audit the outcome, not every
 * routine action" restraint `ai.conversation.*`'s own catalog comment
 * already establishes — a real support/AI workflow could call
 * retrieval many times per minute, and logging every call would be
 * noise, not signal, while also risking the exact "don't store raw
 * queries" spec §21 warns against). See
 * `docs/architecture/ai-knowledge.md` "Observability — what is, and
 * is not, tracked" for the full, honest accounting, and
 * `security.authorization.denied`/`knowledge.rate_limit.exceeded` in
 * the platform audit log (`/admin/audit`) for the real, already-durable
 * signal of retrieval ABUSE specifically, reused rather than
 * duplicated here.
 */

export interface IngestionStatusBreakdown {
  QUEUED: number;
  PROCESSING: number;
  CHUNKING: number;
  EMBEDDING: number;
  READY: number;
  FAILED: number;
  SUPERSEDED: number;
}

export interface KnowledgePlatformSummary {
  organizationCount: number;
  sourceCount: number;
  documentCount: number;
  versionsByStatus: IngestionStatusBreakdown;
  chunkCount: number;
  embeddingCount: number;
}

/** `knowledge.observability` — platform-wide counts, never any organization's own content. */
export async function getKnowledgePlatformSummary(): Promise<KnowledgePlatformSummary> {
  await requirePermission("knowledge.observability");

  return withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, async (tx) => {
    // A zero-WHERE platform query — RLS alone confines a non-platform
    // caller (this codebase's own established "billing-reporting-
    // security.md" reasoning, reused verbatim for a non-billing domain,
    // same as Module 17's `sumUsageByOrganization()` already reuses it).
    const [organizationCount, sourceCount, documentCount, statusRows, chunkCount, embeddingCount] = await Promise.all([
      tx.knowledgeSource.groupBy({ by: ["organizationId"] }).then((rows) => rows.filter((r) => r.organizationId !== null).length),
      tx.knowledgeSource.count(),
      tx.knowledgeDocument.count({ where: { deletedAt: null } }),
      tx.knowledgeDocumentVersion.groupBy({ by: ["status"], _count: { _all: true } }),
      tx.knowledgeChunk.count(),
      tx.knowledgeEmbedding.count(),
    ]);

    const versionsByStatus: IngestionStatusBreakdown = { QUEUED: 0, PROCESSING: 0, CHUNKING: 0, EMBEDDING: 0, READY: 0, FAILED: 0, SUPERSEDED: 0 };
    for (const row of statusRows) versionsByStatus[row.status] = row._count._all;

    return { organizationCount, sourceCount, documentCount, versionsByStatus, chunkCount, embeddingCount };
  });
}
