"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive } from "lucide-react";
import { archiveSalesGoalAction } from "@/app/(protected)/admin/crm/actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** Goals are immutable — a mistaken value/period is corrected by archiving and creating a new one, never edited in place (see `CrmSalesGoal`'s own schema comment). */
export function ArchiveGoalButton({ goalId }: { goalId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await archiveSalesGoalAction({ goalId });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleClick} disabled={pending} variant="ghost" size="sm">
        <Archive className="size-4" aria-hidden="true" />
        Archive
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
