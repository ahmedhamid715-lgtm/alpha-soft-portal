"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ActionResult {
  error?: string;
  data?: unknown;
}

/** Shared archive/reactivate control for `CrmCompany`/`CrmContact` — both lifecycles are the identical `ACTIVE <-> ARCHIVED` shape (see crm-architecture.md "Archival semantics"), so one component drives both instead of two near-duplicate ones. */
export function CrmArchiveToggleButton({
  input,
  isArchived,
  archiveAction,
  reactivateAction,
}: {
  input: unknown;
  isArchived: boolean;
  archiveAction: (input: unknown) => Promise<ActionResult>;
  reactivateAction: (input: unknown) => Promise<ActionResult>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const action = isArchived ? reactivateAction : archiveAction;
      const result = await action(input);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button onClick={handleClick} disabled={pending} variant="outline" size="sm">
        {isArchived ? <ArchiveRestore className="size-4" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}
        {isArchived ? "Reactivate" : "Archive"}
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
