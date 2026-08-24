import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { retrieveKnowledge } from "./knowledge-retrieval-service";
import { selectWithinBudget, DEFAULT_CONTEXT_CHAR_BUDGET } from "@/lib/knowledge/context-budget";
import { renderTrustedContextBlock } from "@/lib/knowledge/trust-boundary";

/**
 * Context assembly (Module 18, spec §13) — the LAST step of the
 * mandatory retrieval pipeline before a future AI module would hand
 * anything to a model:
 *
 *   ... -> RETRIEVAL -> FILTERING -> RANKING -> CONTEXT ASSEMBLY -> AI MODEL
 *
 * Deliberately thin: calls `retrieveKnowledge()` (which independently
 * re-runs the full authorization/tenant/rate-limit chain — this
 * function has NO separate authorization path of its own to
 * accidentally get wrong), then enforces a hard character budget
 * (`context-budget.ts`) and renders every selected item through the
 * trust-boundary labeler (`trust-boundary.ts`) — never a bare string
 * concatenation a future prompt-builder might mistake for an
 * instruction. See `docs/architecture/context-assembly.md`.
 *
 * NOT wired into Module 17's existing AI chat — see
 * `docs/architecture/ai-knowledge.md` "What this module is, and is
 * not" for why that integration is deliberately left to whichever
 * future module builds a real account-data-grounded assistant.
 */

export interface ContextCitation {
  chunkId: string;
  documentId: string;
  sourceId: string;
  score: number;
}

export interface ContextAssemblyResult {
  /** Trust-labeled, boundary-safe text blocks — see `trust-boundary.ts`. Ready to concatenate into a prompt's retrieved-content section; never itself the whole prompt. */
  blocks: string[];
  /** Provenance for every block actually included — spec §12: "context assembly must never destroy provenance." */
  citations: ContextCitation[];
  usedChars: number;
  budgetChars: number;
  /** True if retrieval found more relevant material than the budget could hold — an honest signal, not a silent drop. */
  truncated: boolean;
  /** Propagated from `retrieveKnowledge()` — true if vector search degraded to keyword-only. */
  retrievalDegraded: boolean;
  query: string;
}

const assembleSchema = z.object({
  organizationId: z.string().uuid(),
  query: z.string().min(1).max(2000),
  limit: z.coerce.number().int().min(1).max(20).default(10),
  budgetChars: z.coerce.number().int().min(500).max(50_000).optional(),
});

/** `knowledge.retrieve` (enforced inside `retrieveKnowledge()`, not duplicated here). */
export async function assembleContext(rawInput: unknown): Promise<ContextAssemblyResult> {
  const input = parseOrThrow(assembleSchema, rawInput);
  const retrieval = await retrieveKnowledge({ organizationId: input.organizationId, query: input.query, limit: input.limit });

  const budget = selectWithinBudget(
    retrieval.items.map((item) => ({ id: item.chunkId, content: item.content })),
    input.budgetChars ?? DEFAULT_CONTEXT_CHAR_BUDGET,
  );
  const selectedIds = new Set(budget.selected.map((s) => s.id));
  const selectedItems = retrieval.items.filter((item) => selectedIds.has(item.chunkId));

  const blocks = selectedItems.map((item) => renderTrustedContextBlock({ trustLevel: "retrieved_content", sourceId: item.sourceId, documentId: item.documentId, chunkId: item.chunkId, content: item.content }));
  const citations: ContextCitation[] = selectedItems.map((item) => ({ chunkId: item.chunkId, documentId: item.documentId, sourceId: item.sourceId, score: item.score }));

  return { blocks, citations, usedChars: budget.usedChars, budgetChars: budget.budgetChars, truncated: budget.truncated, retrievalDegraded: retrieval.degraded, query: input.query };
}
