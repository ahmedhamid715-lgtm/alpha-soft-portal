"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDocumentRequestAction, markDocumentReceivedAction } from "@/app/(protected)/admin/crm/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/shared/status-badge";
import { documentStatusVariant } from "./onboarding-status";
import type { CrmClientOnboardingDocument } from "@/generated/prisma/client";

/**
 * Metadata-only document references — no real upload exists in Build 23
 * (see the model's own schema comment; `storage.ts`/Roadmap Module 56 is
 * still unconfigured). Staff record that a document was requested, then
 * later record it was received with an honest note on how — never a
 * fabricated upload/delivery claim.
 */
export function OnboardingDocuments({ onboardingId, documents, canManage }: { onboardingId: string; documents: CrmClientOnboardingDocument[]; canManage: boolean }) {
  const [title, setTitle] = useState("");
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [receivedNote, setReceivedNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function addDocument() {
    if (!title.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createDocumentRequestAction({ onboardingId, title });
      if (result.error) {
        setError(result.error);
        return;
      }
      setTitle("");
      router.refresh();
    });
  }

  function markReceived(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await markDocumentReceivedAction({ documentId: id, receivedNote: receivedNote || undefined });
      if (result.error) {
        setError(result.error);
        return;
      }
      setReceivingId(null);
      setReceivedNote("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">No file upload yet — Alpha OS&apos;s own file storage infrastructure isn&apos;t built. This tracks that a document was requested and later received, not the file itself.</p>
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents requested yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => (
            <li key={doc.id} className="flex flex-col gap-1.5 rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{doc.title}</span>
                <StatusBadge status={documentStatusVariant(doc.status)}>{doc.status}</StatusBadge>
              </div>
              {doc.description ? <p className="text-xs text-muted-foreground">{doc.description}</p> : null}
              {doc.status === "RECEIVED" && doc.receivedNote ? <p className="text-xs text-muted-foreground">Received: {doc.receivedNote}</p> : null}
              {canManage && doc.status === "REQUESTED" ? (
                receivingId === doc.id ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`received-note-${doc.id}`} className="text-xs">
                      How was it received? (optional)
                    </Label>
                    <Input id={`received-note-${doc.id}`} value={receivedNote} onChange={(e) => setReceivedNote(e.target.value)} placeholder="e.g. via email" disabled={pending} maxLength={2000} />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={pending} onClick={() => markReceived(doc.id)}>
                        Confirm received
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setReceivingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="w-fit" disabled={pending} onClick={() => setReceivingId(doc.id)}>
                    Mark received
                  </Button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="flex items-end gap-2 border-t border-border pt-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="new-document">Request a document</Label>
            <Input id="new-document" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Brand style guide" disabled={pending} maxLength={200} />
          </div>
          <Button size="sm" disabled={pending || !title.trim()} onClick={addDocument}>
            Request
          </Button>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
