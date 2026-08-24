"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Trash2 } from "lucide-react";
import { reindexDocumentAction, deleteDocumentAction } from "../../actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function DocumentActions({ organizationId, sourceId, documentId, canReindex }: { organizationId: string; sourceId: string; documentId: string; canReindex: boolean }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleReindex() {
    setError(null);
    startTransition(async () => {
      const result = await reindexDocumentAction({ organizationId, sourceId, documentId });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteDocumentAction({ organizationId, sourceId, documentId });
      setDeleteOpen(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/organizations/${organizationId}/knowledge/${sourceId}`);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        {canReindex ? (
          <Button variant="outline" onClick={handleReindex} disabled={pending}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Re-index
          </Button>
        ) : null}
        <Button variant="outline" onClick={() => setDeleteOpen(true)} disabled={pending}>
          <Trash2 className="size-4" aria-hidden="true" />
          Delete
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive" className="max-w-sm">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this document?"
        description="It stops appearing everywhere — the source's document list and every retrieval query — immediately. This is a soft delete (its history is preserved for compliance), not a permanent erasure."
        confirmLabel="Delete"
        variant="destructive"
        loading={pending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
