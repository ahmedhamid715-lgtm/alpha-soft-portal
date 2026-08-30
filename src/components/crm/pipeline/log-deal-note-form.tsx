"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { logDealNoteAction } from "@/app/(protected)/admin/crm/actions";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function LogDealNoteForm({ dealId }: { dealId: string }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!note.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await logDealNoteAction({ dealId, note });
      if (result.error) {
        setError(result.error);
        return;
      }
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="deal-note">Note</Label>
        <Textarea id="deal-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={pending} maxLength={4000} />
      </div>
      <Button onClick={handleSubmit} disabled={pending || !note.trim()} className="w-fit">
        <Plus className="size-4" aria-hidden="true" />
        Add note
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
