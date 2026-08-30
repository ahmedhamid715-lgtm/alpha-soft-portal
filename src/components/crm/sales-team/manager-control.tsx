"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeSalesTeamManagerAction } from "@/app/(protected)/admin/crm/actions";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { CrmSalesTeamMemberWithUser } from "@/server/repositories/crm-sales-team-member-repository";

const NO_MANAGER = "__no_manager__";

/** `candidateManagers` is already filtered (server-side) to exclude this member themselves. */
export function ManagerControl({ memberId, currentManagerId, candidateManagers }: { memberId: string; currentManagerId: string | null; candidateManagers: CrmSalesTeamMemberWithUser[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleChange(value: string) {
    setError(null);
    startTransition(async () => {
      const result = await changeSalesTeamManagerAction({ memberId, managerId: value === NO_MANAGER ? null : value });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="member-manager-control">Manager</Label>
      <Select value={currentManagerId ?? NO_MANAGER} onValueChange={handleChange} disabled={pending}>
        <SelectTrigger id="member-manager-control" className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_MANAGER}>No manager</SelectItem>
          {candidateManagers.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.user.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
