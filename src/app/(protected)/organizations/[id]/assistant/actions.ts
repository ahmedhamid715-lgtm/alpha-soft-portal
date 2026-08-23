"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { startConversation, sendMessage, closeConversation } from "@/server/services/ai-conversation-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";
import type { AiConversation, AiMessage } from "@/generated/prisma/client";

export interface ChatActionState {
  error?: string;
  conversation?: AiConversation;
  messages?: AiMessage[];
}

const startSchema = z.object({ organizationId: z.string().uuid(), message: z.string() });

/**
 * Called directly (awaited from a client component's own event
 * handler), not through `useForm`/`useActionState` with a plain
 * `<form>` — the caller needs the real assistant reply CONTENT to
 * render into the chat thread, not just an error/success flag, the
 * same "return the real data, not a flag" shape
 * `previewPlanChangeAction()` already established in
 * `organizations/[id]/billing/actions.ts`.
 */
export async function startConversationAction(input: unknown): Promise<ChatActionState> {
  const parsed = safeParseResult(startSchema, input);
  if (!parsed.success) return { error: "Invalid message." };

  try {
    const result = await startConversation(parsed.data);
    revalidatePath(`/organizations/${parsed.data.organizationId}/assistant`);
    return { conversation: result.conversation, messages: result.messages };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

const sendSchema = z.object({ organizationId: z.string().uuid(), conversationId: z.string().uuid(), message: z.string() });

export async function sendMessageAction(input: unknown): Promise<ChatActionState> {
  const parsed = safeParseResult(sendSchema, input);
  if (!parsed.success) return { error: "Invalid message." };

  try {
    const result = await sendMessage(parsed.data);
    return { conversation: result.conversation, messages: result.messages };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

const closeSchema = z.object({ organizationId: z.string().uuid(), conversationId: z.string().uuid() });

export async function closeConversationAction(input: unknown): Promise<ChatActionState> {
  const parsed = safeParseResult(closeSchema, input);
  if (!parsed.success) return { error: "Invalid conversation." };

  try {
    const conversation = await closeConversation(parsed.data);
    revalidatePath(`/organizations/${parsed.data.organizationId}/assistant/${parsed.data.conversationId}`);
    return { conversation };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}
