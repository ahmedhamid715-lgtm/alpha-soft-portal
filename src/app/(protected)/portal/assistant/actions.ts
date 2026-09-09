"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { startConversation, sendMessage, closeConversation } from "@/server/services/ai-conversation-service";
import { requirePermission } from "@/lib/authorization/authorize";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";
import type { AiConversation, AiMessage } from "@/generated/prisma/client";

/**
 * Thin action wrappers around the EXISTING `ai-conversation-service.ts`
 * (Module 17) — the SAME real, already-safe assistant
 * `/organizations/[id]/assistant` uses (see customer-portal.md "AI
 * Assistant" for why this build does not build a second, CRM-grounded
 * pipeline). Only the revalidation target differs from that route's own
 * `actions.ts`. Also independently requires `portal.access` on every
 * mutation (Codex Security Engineer finding, Low — same defense-in-
 * depth reasoning as `updatePortalCompanyProfileAction`'s own comment).
 */
export interface PortalChatMessage {
  id: string;
  role: AiMessage["role"];
  content: string;
  createdAt: Date;
}

export interface PortalChatActionState {
  error?: string;
  conversation?: AiConversation;
  messages?: PortalChatMessage[];
}

/**
 * Codex Security Engineer finding (Medium) — the full `AiMessage` row
 * (model, input/output token counts, estimated cost, latency, the
 * provider's own message id) was reaching the browser's initial page
 * payload as a client-component prop, not just what `ChatMessage`
 * itself visually rendered. None of that is customer-facing — trimmed
 * to exactly what the UI needs at the SERVER boundary, before the data
 * ever crosses into a client component.
 */
function toPortalChatMessage(message: AiMessage): PortalChatMessage {
  return { id: message.id, role: message.role, content: message.content, createdAt: message.createdAt };
}

const startSchema = z.object({ organizationId: z.string().uuid(), message: z.string() });

export async function startPortalConversationAction(input: unknown): Promise<PortalChatActionState> {
  const parsed = safeParseResult(startSchema, input);
  if (!parsed.success) return { error: "Invalid message." };

  try {
    await requirePermission("portal.access", parsed.data.organizationId);
    const result = await startConversation(parsed.data);
    revalidatePath("/portal/assistant");
    return { conversation: result.conversation, messages: result.messages.map(toPortalChatMessage) };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

const sendSchema = z.object({ organizationId: z.string().uuid(), conversationId: z.string().uuid(), message: z.string() });

export async function sendPortalMessageAction(input: unknown): Promise<PortalChatActionState> {
  const parsed = safeParseResult(sendSchema, input);
  if (!parsed.success) return { error: "Invalid message." };

  try {
    await requirePermission("portal.access", parsed.data.organizationId);
    const result = await sendMessage(parsed.data);
    return { conversation: result.conversation, messages: result.messages.map(toPortalChatMessage) };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

const closeSchema = z.object({ organizationId: z.string().uuid(), conversationId: z.string().uuid() });

export async function closePortalConversationAction(input: unknown): Promise<PortalChatActionState> {
  const parsed = safeParseResult(closeSchema, input);
  if (!parsed.success) return { error: "Invalid conversation." };

  try {
    await requirePermission("portal.access", parsed.data.organizationId);
    const conversation = await closeConversation(parsed.data);
    revalidatePath(`/portal/assistant/${parsed.data.conversationId}`);
    return { conversation };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}
