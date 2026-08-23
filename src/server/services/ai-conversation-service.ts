import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext, type TenantContextInput } from "@/lib/tenancy/context";
import { aiConversationRepository } from "@/server/repositories/ai-conversation-repository";
import { anthropicChatProvider } from "@/lib/ai/provider/anthropic/provider";
import { computeCost } from "@/lib/ai/pricing";
import { SUPPORT_CHAT_SYSTEM_PROMPT, MAX_MESSAGE_LENGTH, MAX_RESPONSE_TOKENS, MAX_CONTEXT_MESSAGES } from "@/lib/ai/system-prompt";
import { aiRateLimiter } from "@/lib/platform/rate-limit";
import { audit } from "@/lib/audit/service";
import { RateLimitError, ValidationError, NotFoundError } from "@/lib/errors/app-error";
import { type CursorPaginationParams, type CursorPaginatedResult } from "@/lib/platform/pagination";
import type { AuthorizationContext } from "@/lib/authorization/context";
import type { AiConversation, AiMessage } from "@/generated/prisma/client";

/**
 * The AI support-chat conversation service (Module 17) — the ONLY
 * caller of `anthropicChatProvider` in the codebase. A real, non-
 * streaming request/response round trip: every write happens in a
 * SHORT `withTenantContext()` transaction, with the actual Anthropic
 * API call made OUTSIDE any transaction (spec's own "do not hold a
 * transaction open across an external network call" rule) — the exact
 * same "create local state, call the provider, reconcile after" shape
 * `subscription-service.ts`'s own `startCheckoutForPlanPrice()` already
 * establishes for Stripe.
 *
 * If the provider call fails (unconfigured, timeout, API error), the
 * caller's own USER message remains persisted — real data, independent
 * of whether the assistant could reply — and the error propagates as a
 * safe `ExternalServiceError`, never a crash, never a fabricated reply.
 */

function validateMessageContent(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new ValidationError("Message cannot be empty.", { details: { field: "message" } });
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new ValidationError(`Message exceeds the ${MAX_MESSAGE_LENGTH}-character limit.`, { details: { field: "message" } });
  }
  return trimmed;
}

function deriveTitle(firstMessage: string): string {
  return firstMessage.length > 60 ? `${firstMessage.slice(0, 57)}...` : firstMessage;
}

async function auditConversationStarted(context: AuthorizationContext, organizationId: string, conversationId: string): Promise<void> {
  await audit
    .recordSuccess({
      action: "ai.conversation.started",
      organizationId,
      resourceType: "ai_conversation",
      resourceId: conversationId,
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record ai.conversation.started", error));
}

async function auditConversationClosed(context: AuthorizationContext, organizationId: string, conversationId: string): Promise<void> {
  await audit
    .recordSuccess({
      action: "ai.conversation.closed",
      organizationId,
      resourceType: "ai_conversation",
      resourceId: conversationId,
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record ai.conversation.closed", error));
}

async function auditRateLimitExceeded(context: AuthorizationContext, organizationId: string): Promise<void> {
  await audit
    .recordSuccess({
      action: "ai.rate_limit.exceeded",
      organizationId,
      resourceType: "organization",
      resourceId: organizationId,
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record ai.rate_limit.exceeded", error));
}

/**
 * Calls the real provider with the conversation's own recent history
 * (bounded to `MAX_CONTEXT_MESSAGES`), then writes the ASSISTANT
 * message in its own short transaction. Left OUTSIDE any transaction
 * during the network call itself — see this file's own top comment.
 */
async function generateAssistantReply(conversationId: string, tenantScope: TenantContextInput): Promise<AiMessage> {
  const priorMessages = await withTenantContext(tenantScope, (tx) => aiConversationRepository.listRecentMessages(conversationId, MAX_CONTEXT_MESSAGES, tx));

  const startedAt = Date.now();
  const result = await anthropicChatProvider.sendMessage({
    system: SUPPORT_CHAT_SYSTEM_PROMPT,
    messages: priorMessages.map((m) => ({ role: m.role === "USER" ? ("user" as const) : ("assistant" as const), content: m.content })),
    maxTokens: MAX_RESPONSE_TOKENS,
  });
  const latencyMs = Date.now() - startedAt;
  const costMinorUnits = computeCost(result.model, result.inputTokens, result.outputTokens);

  return withTenantContext(tenantScope, async (tx) => {
    const message = await aiConversationRepository.addMessage(
      {
        id: generateId(),
        conversationId,
        role: "ASSISTANT",
        content: result.content,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costMinorUnits,
        latencyMs,
        providerMessageId: result.providerMessageId,
      },
      tx,
    );
    await aiConversationRepository.touchUpdatedAt(conversationId, tx);
    return message;
  });
}

export interface ConversationWithMessages {
  conversation: AiConversation;
  messages: AiMessage[];
}

const startConversationSchema = z.object({ organizationId: z.string().uuid(), message: z.string() });

/** `ai.use` — starts a new conversation with a first message, and gets the assistant's real reply in the same call. */
export async function startConversation(rawInput: unknown): Promise<ConversationWithMessages> {
  const input = parseOrThrow(startConversationSchema, rawInput);
  const context = await requirePermission("ai.use", input.organizationId);
  const message = validateMessageContent(input.message);

  const rateLimit = await aiRateLimiter.check(`ai:${input.organizationId}`);
  if (!rateLimit.allowed) {
    await auditRateLimitExceeded(context, input.organizationId);
    throw new RateLimitError("This organization has reached its AI message limit. Try again later.");
  }

  const tenantScope: TenantContextInput = { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff };
  const conversationId = generateId();

  await withTenantContext(tenantScope, async (tx) => {
    await aiConversationRepository.create({ id: conversationId, organizationId: input.organizationId, userId: context.user!.id, title: deriveTitle(message) }, tx);
    await aiConversationRepository.addMessage({ id: generateId(), conversationId, role: "USER", content: message }, tx);
  });

  await auditConversationStarted(context, input.organizationId, conversationId);
  await generateAssistantReply(conversationId, tenantScope);

  const full = await withTenantContext(tenantScope, (tx) => aiConversationRepository.findByIdWithMessages(conversationId, tx));
  if (!full) throw new NotFoundError("Conversation");
  const { messages, ...conversation } = full;
  return { conversation, messages };
}

const sendMessageSchema = z.object({ organizationId: z.string().uuid(), conversationId: z.string().uuid(), message: z.string() });

/**
 * `ai.use` — continues an EXISTING conversation. `conversationId` is a
 * client-supplied hint only: both `organizationId` (re-verified via
 * `requirePermission`) and the conversation's own `userId` (checked
 * below, inside the tenant-scoped transaction) are what actually
 * authorize this call — never the presence of a plausible-looking id
 * alone. Restricted to the conversation's OWN owner even for a caller
 * who holds `ai.manage` — oversight (`ai.manage`) grants VIEWING and
 * CLOSING another member's conversation, never posting messages as if
 * they were that member (see `ai-infrastructure.md` "Tenant model").
 */
export async function sendMessage(rawInput: unknown): Promise<ConversationWithMessages> {
  const input = parseOrThrow(sendMessageSchema, rawInput);
  const context = await requirePermission("ai.use", input.organizationId);
  const message = validateMessageContent(input.message);

  const rateLimit = await aiRateLimiter.check(`ai:${input.organizationId}`);
  if (!rateLimit.allowed) {
    await auditRateLimitExceeded(context, input.organizationId);
    throw new RateLimitError("This organization has reached its AI message limit. Try again later.");
  }

  const tenantScope: TenantContextInput = { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff };

  await withTenantContext(tenantScope, async (tx) => {
    const conversation = await aiConversationRepository.findById(input.conversationId, tx);
    if (!conversation || conversation.organizationId !== input.organizationId) throw new NotFoundError("Conversation");
    if (conversation.userId !== context.user!.id) throw new NotFoundError("Conversation");
    if (conversation.status === "CLOSED") throw new ValidationError("This conversation is closed.");
    await aiConversationRepository.addMessage({ id: generateId(), conversationId: input.conversationId, role: "USER", content: message }, tx);
  });

  await generateAssistantReply(input.conversationId, tenantScope);

  const full = await withTenantContext(tenantScope, (tx) => aiConversationRepository.findByIdWithMessages(input.conversationId, tx));
  if (!full) throw new NotFoundError("Conversation");
  const { messages, ...conversation } = full;
  return { conversation, messages };
}

const getConversationSchema = z.object({ organizationId: z.string().uuid(), conversationId: z.string().uuid() });

/** `ai.use` (own conversation) or `ai.manage` (any conversation in the organization) — a read, no message sent. */
export async function getConversation(rawInput: unknown): Promise<ConversationWithMessages> {
  const input = parseOrThrow(getConversationSchema, rawInput);
  const context = await requirePermission("ai.use", input.organizationId);

  const full = await withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, (tx) =>
    aiConversationRepository.findByIdWithMessages(input.conversationId, tx),
  );
  if (!full || full.organizationId !== input.organizationId) throw new NotFoundError("Conversation");
  if (full.userId !== context.user!.id && !context.permissions.has("ai.manage")) throw new NotFoundError("Conversation");

  const { messages, ...conversation } = full;
  return { conversation, messages };
}

const listConversationsSchema = z.object({ organizationId: z.string().uuid(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });

/** `ai.use` — this user's own conversations, most-recently-active first. `ai.manage` holders see EVERY conversation in the organization instead (oversight). */
export async function listConversations(rawInput: unknown): Promise<CursorPaginatedResult<AiConversation>> {
  const input = parseOrThrow(listConversationsSchema, rawInput);
  const context = await requirePermission("ai.use", input.organizationId);
  const params: CursorPaginationParams = { cursor: input.cursor, limit: input.limit };

  return withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, (tx) =>
    context.permissions.has("ai.manage")
      ? aiConversationRepository.listForOrganization(input.organizationId, params, tx)
      : aiConversationRepository.listForUser(input.organizationId, context.user!.id, params, tx),
  );
}

const closeConversationSchema = z.object({ organizationId: z.string().uuid(), conversationId: z.string().uuid() });

/** `ai.use` (own conversation) or `ai.manage` (any conversation) — never destructive; a closed conversation's history remains fully readable. */
export async function closeConversation(rawInput: unknown): Promise<AiConversation> {
  const input = parseOrThrow(closeConversationSchema, rawInput);
  const context = await requirePermission("ai.use", input.organizationId);

  const closed = await withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, async (tx) => {
    const conversation = await aiConversationRepository.findById(input.conversationId, tx);
    if (!conversation || conversation.organizationId !== input.organizationId) throw new NotFoundError("Conversation");
    if (conversation.userId !== context.user!.id && !context.permissions.has("ai.manage")) throw new NotFoundError("Conversation");
    return aiConversationRepository.close(input.conversationId, tx);
  });

  await auditConversationClosed(context, input.organizationId, input.conversationId);
  return closed;
}
