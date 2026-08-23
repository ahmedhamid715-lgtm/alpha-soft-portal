"use client";

import { useState, useTransition } from "react";
import { SendHorizontal, X } from "lucide-react";
import { sendMessageAction, closeConversationAction } from "../actions";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChatMessage, ChatThread, AIThinkingIndicator } from "@/components/shared/ai-chat";
import type { AiMessage } from "@/generated/prisma/client";

const MAX_LENGTH = 4000;

function formatMessage(message: AiMessage) {
  return (
    <ChatMessage
      key={message.id}
      role={message.role === "USER" ? "user" : "assistant"}
      content={message.content}
      timestamp={new Date(message.createdAt).toLocaleTimeString()}
    />
  );
}

/** Client-side thread state, seeded from the server-rendered initial messages, then updated in place as `sendMessage`'s real assistant reply arrives — never a full page reload per turn. */
export function ContinueChatForm({
  organizationId,
  conversationId,
  initialMessages,
  initiallyOpen,
  canSend,
  canClose,
}: {
  organizationId: string;
  conversationId: string;
  initialMessages: AiMessage[];
  initiallyOpen: boolean;
  /** Only the conversation's OWN owner may post new messages — see `ai-conversation-service.ts`'s own `sendMessage()` doc comment. */
  canSend: boolean;
  /** The owner, or an `ai.manage` holder (oversight) — see `closeConversation()`'s own doc comment. */
  canClose: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [open, setOpen] = useState(initiallyOpen);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sendPending, startSendTransition] = useTransition();
  const [closePending, startCloseTransition] = useTransition();

  function handleSend() {
    if (!message.trim()) return;
    setError(null);
    const pendingText = message;
    setMessage("");
    startSendTransition(async () => {
      const result = await sendMessageAction({ organizationId, conversationId, message: pendingText });
      if (result.error) {
        setError(result.error);
        setMessage(pendingText);
        return;
      }
      if (result.messages) setMessages(result.messages);
    });
  }

  function handleClose() {
    startCloseTransition(async () => {
      const result = await closeConversationAction({ organizationId, conversationId });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ChatThread>{messages.map(formatMessage)}</ChatThread>
      {sendPending ? <AIThinkingIndicator /> : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!open ? (
        <p className="text-sm text-muted-foreground">This conversation is closed.</p>
      ) : !canSend ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">You&apos;re viewing this as an organization admin — only the conversation&apos;s own owner can post new messages.</p>
          {canClose ? (
            <Button variant="outline" onClick={handleClose} disabled={closePending}>
              <X className="size-4" aria-hidden="true" />
              Close conversation
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MAX_LENGTH))}
            placeholder="Continue the conversation…"
            aria-label="New message"
            rows={2}
            disabled={sendPending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{message.length}/{MAX_LENGTH}</span>
            <div className="flex gap-2">
              {canClose ? (
                <Button variant="outline" onClick={handleClose} disabled={closePending}>
                  <X className="size-4" aria-hidden="true" />
                  Close conversation
                </Button>
              ) : null}
              <Button onClick={handleSend} disabled={sendPending || !message.trim()}>
                <SendHorizontal className="size-4" aria-hidden="true" />
                Send
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
