import "server-only";
import { getAnthropicClient, anthropicModel } from "./client";
import type { AiChatProvider } from "../interface";
import type { SendChatMessageInput, SendChatMessageResult } from "../types";
import { ExternalServiceError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging";

/**
 * The real Anthropic implementation of `AiChatProvider` — the ONLY file
 * in the codebase that imports `@anthropic-ai/sdk` (besides `client.ts`
 * itself). A single, non-streaming `messages.create()` call per
 * invocation — no tool use, no function calling (see `interface.ts`'s
 * own top comment for why; this module's scope is a conversational
 * assistant, not an agent acting on the customer's data). Streaming is
 * a real, documented future enhancement (`ai-infrastructure.md` "Known
 * limitations") — deliberately not built here: it would need a
 * different transport (SSE via a Route Handler, not a plain Server
 * Action) for no functional gain a non-streaming foundation doesn't
 * already deliver honestly.
 */
export const anthropicChatProvider: AiChatProvider = {
  async sendMessage(input: SendChatMessageInput): Promise<SendChatMessageResult> {
    const client = getAnthropicClient();
    let response;
    try {
      response = await client.messages.create({
        model: anthropicModel(),
        max_tokens: input.maxTokens,
        system: input.system,
        messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      });
    } catch (error) {
      // Never let a raw Anthropic SDK error (which may include request
      // details) escape this boundary — map to the same safe domain
      // error every other provider failure in this codebase uses.
      logger.error("Anthropic API call failed.", { operation: "ai.provider.anthropic_call_failed", error: error instanceof Error ? error.message : String(error) });
      throw new ExternalServiceError("Anthropic", { cause: error });
    }

    const content = response.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return {
      content,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      providerMessageId: response.id,
      stopReason: response.stop_reason ?? "unknown",
    };
  },
};
