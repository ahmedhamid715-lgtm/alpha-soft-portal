import "server-only";
import OpenAI from "openai";
import { serverEnv, isOpenAiConfigured } from "@/config/environment";
import { ExternalServiceError } from "@/lib/errors/app-error";

/**
 * The OpenAI SDK client — instantiated ONCE, from `serverEnv`, never
 * `process.env` directly. Imported ONLY by `openai/provider.ts` — the
 * exact same "one file owns the raw SDK" discipline
 * `lib/ai/provider/anthropic/client.ts` (Module 17) and
 * `lib/billing/provider/stripe/client.ts` (Module 13) already
 * established.
 */
let cachedClient: OpenAI | null = null;

/**
 * `text-embedding-3-small` — 1536 dimensions, matching
 * `knowledge_embeddings.vector`'s fixed schema dimension exactly. See
 * `docs/architecture/retrieval.md` "Embedding dimension is a schema
 * decision, not a config one": changing this to a model with a
 * DIFFERENT dimension (e.g. `text-embedding-3-large`, 3072) requires a
 * new migration, not just this default changing.
 */
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSION = 1536;

export function embeddingModel(): string {
  return serverEnv.OPENAI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
}

export function getOpenAiClient(): OpenAI {
  if (!isOpenAiConfigured) {
    // A clear, safe failure rather than the SDK's own less-obvious error
    // — the one place `isOpenAiConfigured` gates every real embedding
    // call in the codebase, mirroring `getAnthropicClient()` exactly.
    throw new ExternalServiceError("OpenAI");
  }
  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey: serverEnv.OPENAI_API_KEY!, baseURL: serverEnv.OPENAI_BASE_URL });
  }
  return cachedClient;
}
