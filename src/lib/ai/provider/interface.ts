import type { SendChatMessageInput, SendChatMessageResult } from "./types";

/**
 * The AI provider abstraction (Module 17) — the one boundary Alpha OS's
 * AI domain is allowed to depend on, mirroring
 * `lib/billing/provider/interface.ts` exactly. `anthropic/provider.ts`
 * is the only implementation today; the OpenAI env vars Module 01
 * already reserved (`OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_CHAT_MODEL`)
 * are a real, documented extension point for a second adapter against
 * this SAME interface — not built here (no second real caller exists
 * yet to justify it; see `ai-infrastructure.md` "Why only one provider
 * is implemented").
 */
export interface AiChatProvider {
  sendMessage(input: SendChatMessageInput): Promise<SendChatMessageResult>;
}
