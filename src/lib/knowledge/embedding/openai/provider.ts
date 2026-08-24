import "server-only";
import { getOpenAiClient, embeddingModel, EMBEDDING_DIMENSION } from "./client";
import type { EmbeddingProvider } from "../interface";
import type { EmbedInput, EmbedResult } from "../types";
import { ExternalServiceError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging";

/**
 * The real OpenAI implementation of `EmbeddingProvider` — the ONLY file
 * in the codebase that imports the `openai` SDK (besides `client.ts`
 * itself). A single, batched `embeddings.create()` call per invocation.
 */
export const openAiEmbeddingProvider: EmbeddingProvider = {
  async embed(input: EmbedInput): Promise<EmbedResult> {
    const client = getOpenAiClient();
    const model = embeddingModel();
    let response;
    try {
      response = await client.embeddings.create({ model, input: input.texts });
    } catch (error) {
      // Never let a raw OpenAI SDK error escape this boundary — map to
      // the same safe domain error every other provider failure in this
      // codebase uses (see anthropic/provider.ts's identical reasoning).
      logger.error("OpenAI embeddings call failed.", { operation: "knowledge.embedding.openai_call_failed", error: error instanceof Error ? error.message : String(error) });
      throw new ExternalServiceError("OpenAI", { cause: error });
    }

    const items = response.data.map((d) => ({ vector: d.embedding, index: d.index }));
    const dimension = items[0]?.vector.length ?? 0;

    // A real, deterministic safety check, not a formality: if the
    // configured model ever returns a dimension other than the schema's
    // fixed 1536 (an operator changed `OPENAI_EMBEDDING_MODEL` to a
    // different-dimension model without also running the migration
    // `retrieval.md` documents), fail loudly here rather than let a
    // malformed vector reach a raw SQL insert.
    if (items.length > 0 && dimension !== EMBEDDING_DIMENSION) {
      logger.error("Embedding model returned an unexpected dimension — schema is fixed, see retrieval.md.", {
        operation: "knowledge.embedding.dimension_mismatch",
        model,
        gotDimension: dimension,
        expectedDimension: EMBEDDING_DIMENSION,
      });
      throw new ExternalServiceError("OpenAI", { details: { reason: "dimension_mismatch" } });
    }

    return { items, model: response.model, dimension };
  },
};
