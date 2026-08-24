import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext, type TenantContextInput } from "@/lib/tenancy/context";
import { knowledgeChunkRepository, type ChunkSearchRow } from "@/server/repositories/knowledge-chunk-repository";
import { knowledgeEmbeddingRepository } from "@/server/repositories/knowledge-embedding-repository";
import { openAiEmbeddingProvider } from "@/lib/knowledge/embedding/openai/provider";
import { CHUNKING_STRATEGY } from "@/lib/knowledge/chunking";
import { reciprocalRankFusion } from "@/lib/knowledge/ranking";
import { knowledgeRetrievalRateLimiter } from "@/lib/platform/rate-limit";
import { audit } from "@/lib/audit/service";
import { RateLimitError } from "@/lib/errors/app-error";
import type { AuthorizationContext } from "@/lib/authorization/context";

/**
 * Hybrid retrieval (Module 18, spec §7/§8). The mandatory chokepoint
 * this whole module exists to build:
 *
 *   USER -> AUTHENTICATION -> AUTHORIZATION -> TENANT CONTEXT ->
 *   KNOWLEDGE ACCESS POLICY -> RETRIEVAL -> FILTERING -> RANKING ->
 *   (CONTEXT ASSEMBLY, see knowledge-context-assembly-service.ts)
 *
 * `requirePermission()` (authorization) runs BEFORE `includeElevated`
 * is even computed, which runs BEFORE either search query is built —
 * authorization decides WHAT the query is even allowed to look at,
 * never a filter applied to results after the fact (spec §8's own
 * explicit prohibition: "do not retrieve everything, perform
 * similarity search, [then] filter unauthorized records afterward").
 *
 * **Graceful degradation, not a hard failure**: if the embedding
 * provider is unavailable (unconfigured `OPENAI_API_KEY` in this dev
 * environment, or a real outage), retrieval degrades to keyword-only
 * search rather than failing the whole request — a real, honest
 * fallback (the response says so via `degraded: true`), not a silent
 * loss of capability.
 */

const EMBEDDING_PROVIDER = "openai";
/** Each individual search strategy fetches more candidates than the final result count so RRF has real material to fuse from — a strategy that happens to rank the eventual #1 result 8th within its own list still needs to be represented in the fusion input. */
const CANDIDATE_MULTIPLIER = 3;

async function auditRateLimitExceeded(context: AuthorizationContext, organizationId: string): Promise<void> {
  await audit
    .recordSuccess({ action: "knowledge.rate_limit.exceeded", organizationId, resourceType: "organization", resourceId: organizationId, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record knowledge.rate_limit.exceeded", error));
}

export interface RetrievedItem {
  chunkId: string;
  documentVersionId: string;
  documentId: string;
  sourceId: string;
  content: string;
  /** Fused RRF score — higher is better, comparable only to other items in the SAME response, never a stable cross-call absolute measure (spec §12: real, but not a universal metric). */
  score: number;
  /** 1 = matched only one of keyword/vector search, 2 = matched both — real provenance about WHY this ranked where it did. */
  matchedIn: number;
}

export interface RetrievalResult {
  items: RetrievedItem[];
  query: string;
  /** True if vector search could not run (embedding provider unavailable) — the response is real keyword-only results, not a failure, but honestly flagged. */
  degraded: boolean;
}

const retrieveSchema = z.object({
  organizationId: z.string().uuid(),
  query: z.string().min(1).max(2000),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

/** `knowledge.retrieve` — the one real retrieval entry point every future AI module should call, never a direct repository/query call from outside this service. */
export async function retrieveKnowledge(rawInput: unknown): Promise<RetrievalResult> {
  const input = parseOrThrow(retrieveSchema, rawInput);
  const context = await requirePermission("knowledge.retrieve", input.organizationId);

  const rateLimit = await knowledgeRetrievalRateLimiter.check(`knowledge:${input.organizationId}`);
  if (!rateLimit.allowed) {
    await auditRateLimitExceeded(context, input.organizationId);
    throw new RateLimitError("This organization has reached its knowledge retrieval limit. Try again later.");
  }

  // The ACCESS POLICY step, decided from a verified permission grant —
  // never client input. See lib/knowledge/classification.ts.
  const includeElevated = context.permissions.has("knowledge.source.manage");
  const tenantScope: TenantContextInput = { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff };
  const candidateLimit = input.limit * CANDIDATE_MULTIPLIER;

  let vectorRows: ChunkSearchRow[] = [];
  let degraded = false;
  try {
    const embedResult = await openAiEmbeddingProvider.embed({ texts: [input.query] });
    const queryVector = embedResult.items[0]?.vector;
    if (queryVector && queryVector.length > 0) {
      vectorRows = await withTenantContext(tenantScope, (tx) =>
        knowledgeEmbeddingRepository.vectorSearch({ organizationId: input.organizationId, provider: EMBEDDING_PROVIDER, model: embedResult.model, queryVector, includeElevatedClassifications: includeElevated, limit: candidateLimit }, tx),
      );
    }
  } catch {
    // Unconfigured/unavailable embedding provider — degrade, don't fail
    // the whole retrieval. See this file's own top comment.
    degraded = true;
  }

  const keywordRows = await withTenantContext(tenantScope, (tx) =>
    knowledgeChunkRepository.keywordSearch({ organizationId: input.organizationId, chunkingStrategy: CHUNKING_STRATEGY, query: input.query, includeElevatedClassifications: includeElevated, limit: candidateLimit }, tx),
  );

  const fused = reciprocalRankFusion([keywordRows.map((r) => ({ id: r.chunkId })), vectorRows.map((r) => ({ id: r.chunkId }))]);

  const byId = new Map<string, ChunkSearchRow>();
  for (const row of [...keywordRows, ...vectorRows]) byId.set(row.chunkId, row);

  const items: RetrievedItem[] = fused
    .slice(0, input.limit)
    .map((f) => {
      const row = byId.get(f.id);
      return row ? { row, f } : null;
    })
    .filter((pair): pair is { row: ChunkSearchRow; f: (typeof fused)[number] } => pair !== null)
    .map(({ row, f }) => ({
      chunkId: row.chunkId,
      documentVersionId: row.documentVersionId,
      documentId: row.documentId,
      sourceId: row.sourceId,
      content: row.content,
      score: f.score,
      matchedIn: f.matchedIn,
    }));

  return { items, query: input.query, degraded };
}
