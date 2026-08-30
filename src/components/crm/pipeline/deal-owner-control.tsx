"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { changeDealOwnerAction } from "@/app/(protected)/admin/crm/actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { User } from "@/generated/prisma/client";

const UNASSIGNED = "__unassigned__";

export function DealOwnerControl({ dealId, assignedToUserId, users }: { dealId: string; assignedToUserId: string | null; users: User[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleChange(value: string) {
    setError(null);
    startTransition(async () => {
      const result = await changeDealOwnerAction({ dealId, assignedToUserId: value === UNASSIGNED ? null : value });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Select value={assignedToUserId ?? UNASSIGNED} onValueChange={handleChange} disabled={pending}>
        <SelectTrigger aria-label="Deal owner" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
          {users.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name}
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
