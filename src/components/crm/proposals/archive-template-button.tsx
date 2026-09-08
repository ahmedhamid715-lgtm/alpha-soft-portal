"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveProposalTemplateAction, reactivateProposalTemplateAction } from "@/app/(protected)/admin/crm/actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** Mirrors `ArchiveToggleButton`'s own shape for the other CRM archived-status entities. */
export function ArchiveTemplateButton({ templateId, status }: { templateId: string; status: "ACTIVE" | "ARCHIVED" }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = status === "ACTIVE" ? await archiveProposalTemplateAction({ templateId }) : await reactivateProposalTemplateAction({ templateId });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={toggle}>
        {status === "ACTIVE" ? "Archive" : "Reactivate"}
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
