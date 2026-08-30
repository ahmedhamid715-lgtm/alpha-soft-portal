"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { addSalesTeamMemberAction } from "@/app/(protected)/admin/crm/actions";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { User } from "@/generated/prisma/client";
import type { CrmSalesTeamMemberWithUser } from "@/server/repositories/crm-sales-team-member-repository";

const NO_MANAGER = "__no_manager__";

/** `eligibleUsers` is already filtered (server-side) to platform staff who are NOT currently an active member — see the overview page's own comment for why. */
export function AddMemberForm({ eligibleUsers, activeMembers }: { eligibleUsers: User[]; activeMembers: CrmSalesTeamMemberWithUser[] }) {
  const [userId, setUserId] = useState(eligibleUsers[0]?.id ?? "");
  const [managerId, setManagerId] = useState(NO_MANAGER);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!userId) return;
    setError(null);
    startTransition(async () => {
      const result = await addSalesTeamMemberAction({ userId, managerId: managerId === NO_MANAGER ? undefined : managerId });
      if (result.error) {
        setError(result.error);
        return;
      }
      setManagerId(NO_MANAGER);
      router.refresh();
    });
  }

  if (eligibleUsers.length === 0) {
    return <p className="text-sm text-muted-foreground">Every active platform staff member is already on the sales team.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="member-user">User</Label>
          <Select value={userId} onValueChange={setUserId} disabled={pending}>
            <SelectTrigger id="member-user" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {eligibleUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="member-manager">Manager (optional)</Label>
          <Select value={managerId} onValueChange={setManagerId} disabled={pending}>
            <SelectTrigger id="member-manager" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_MANAGER}>No manager</SelectItem>
              {activeMembers.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button onClick={handleSubmit} disabled={pending || !userId} className="w-fit">
        <UserPlus className="size-4" aria-hidden="true" />
        Add to sales team
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
