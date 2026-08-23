/**
 * Provider-agnostic input/output shapes (Module 17) — the exact same
 * discipline `lib/billing/provider/types.ts` already established:
 * everything here is expressed purely in Alpha OS domain terms, never a
 * raw Anthropic SDK type. `provider/anthropic/provider.ts` is the ONLY
 * file that translates between these and the real `@anthropic-ai/sdk`
 * objects — nothing else in the codebase should import that package at
 * all. See `interface.ts` for the adapter contract these types serve.
 */

export interface AiChatMessageInput {
  role: "user" | "assistant";
  content: string;
}

export interface SendChatMessageInput {
  /** The system prompt scoping the assistant's behavior — see `system-prompt.ts`. Never user-authored; always this module's own fixed prompt. */
  system: string;
  /** The full conversation so far, oldest first, ending with the newest USER message. */
  messages: AiChatMessageInput[];
  maxTokens: number;
}

export interface SendChatMessageResult {
  content: string;
  /** The real model identifier the provider actually used (a model alias may resolve to a dated snapshot — Anthropic's own `response.model`). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** The provider's own message id — kept for support/tracing, never shown to the end user as anything but an opaque reference. */
  providerMessageId: string;
  stopReason: string;
}
