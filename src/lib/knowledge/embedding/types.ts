/**
 * Provider-agnostic embedding shapes (Module 18) — the exact same
 * discipline `lib/ai/provider/types.ts` (Module 17) and
 * `lib/billing/provider/types.ts` (Module 13) already established:
 * everything here is expressed purely in Alpha OS domain terms, never a
 * raw OpenAI SDK type. `embedding/openai/provider.ts` is the ONLY file
 * that translates between these and the real `openai` SDK objects —
 * nothing else in the codebase should import that package at all.
 */

export interface EmbedInput {
  /** Batched — a real embedding call accepts multiple inputs in one request; every real provider implementation should batch, not loop one-at-a-time. */
  texts: string[];
}

export interface EmbedResultItem {
  vector: number[];
  /** Position in the original `texts` array — providers are not guaranteed to preserve order under every failure/retry path, so callers must not assume index alignment without checking this. */
  index: number;
}

export interface EmbedResult {
  items: EmbedResultItem[];
  /** The real model identifier the provider actually used. */
  model: string;
  /** The real output vector dimension — MUST equal `knowledge_embeddings.vector`'s fixed schema dimension (1536) for this to be storable; the repository layer rejects a mismatch rather than silently truncating/padding (see `knowledge-embedding-repository.ts`). */
  dimension: number;
}
