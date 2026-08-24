import type { EmbedInput, EmbedResult } from "./types";

/**
 * The embedding provider abstraction (Module 18) — the one boundary
 * Alpha OS's knowledge/retrieval domain is allowed to depend on for
 * turning text into vectors, mirroring `lib/ai/provider/interface.ts`
 * (Module 17) exactly. `embedding/openai/provider.ts` is the only
 * implementation today. A future second embedding provider (a model
 * upgrade, a different vendor) implements this SAME interface — the
 * retrieval/context-assembly/authorization/tenant layers never change
 * to support it (spec §26). See `docs/architecture/retrieval.md`
 * "Provider abstraction."
 */
export interface EmbeddingProvider {
  embed(input: EmbedInput): Promise<EmbedResult>;
}
