"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserMinus } from "lucide-react";
import { removeSalesTeamMemberAction } from "@/app/(protected)/admin/crm/actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** Removal is `status = INACTIVE`, never a hard delete — see `CrmSalesTeamMember`'s own schema comment. Any direct reports lose their manager pointer (`SET NULL`), not reassigned automatically. */
export function RemoveMemberButton({ memberId }: { memberId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await removeSalesTeamMemberAction({ memberId });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/admin/crm/sales-team");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button onClick={handleClick} disabled={pending} variant="outline" size="sm">
        <UserMinus className="size-4" aria-hidden="true" />
        Remove from sales team
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
