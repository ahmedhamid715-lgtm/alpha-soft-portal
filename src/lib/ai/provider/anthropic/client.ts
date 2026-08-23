import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { serverEnv, isAnthropicConfigured } from "@/config/environment";
import { ExternalServiceError } from "@/lib/errors/app-error";

/**
 * The Anthropic SDK client — instantiated ONCE, from `serverEnv`, never
 * `process.env` directly. Imported ONLY by
 * `anthropic/provider.ts` — the exact same "one file owns the raw SDK"
 * discipline `lib/billing/provider/stripe/client.ts` already
 * established.
 */
let cachedClient: Anthropic | null = null;

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

export function anthropicModel(): string {
  return serverEnv.ANTHROPIC_CHAT_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
}

export function getAnthropicClient(): Anthropic {
  if (!isAnthropicConfigured) {
    // A clear, safe failure rather than the SDK's own less-obvious error
    // — the one place `isAnthropicConfigured` gates every real Anthropic
    // call in the codebase, mirroring `getStripeClient()` exactly.
    throw new ExternalServiceError("Anthropic");
  }
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY! });
  }
  return cachedClient;
}
