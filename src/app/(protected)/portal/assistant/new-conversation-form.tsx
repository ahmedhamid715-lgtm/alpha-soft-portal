"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SendHorizontal } from "lucide-react";
import { startPortalConversationAction } from "./actions";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AIThinkingIndicator } from "@/components/shared/ai-chat";

const MAX_LENGTH = 4000;

export function NewPortalConversationForm({ organizationId }: { organizationId: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!message.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await startPortalConversationAction({ organizationId, message });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.conversation) router.push(`/portal/assistant/${result.conversation.id}`);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={MAX_LENGTH} rows={3} placeholder="Ask a question…" disabled={pending} />
      <div className="flex items-center justify-between gap-2">
        {pending ? <AIThinkingIndicator /> : <span />}
        <Button onClick={handleSubmit} disabled={pending || !message.trim()}>
          <SendHorizontal className="size-4" aria-hidden="true" />
          Send
        </Button>
      </div>
    </div>
  );
}
