"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setClientSuccessOwnerAction, setManagementAttentionFlagAction } from "@/app/(protected)/admin/crm/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { User } from "@/generated/prisma/client";

const UNASSIGNED = "__unassigned__";

/** CS owner assignment + the one manual signal this build allows (a management-attention flag, never a numeric health override — see client-success.md "Manual overrides"). */
export function ClientSuccessOwnerPanel({
  companyId,
  users,
  currentOwnerUserId,
  attentionFlag,
  attentionReason,
}: {
  companyId: string;
  users: User[];
  currentOwnerUserId: string | null;
  attentionFlag: boolean;
  attentionReason: string | null;
}) {
  const [ownerId, setOwnerId] = useState(currentOwnerUserId ?? UNASSIGNED);
  const [flag, setFlag] = useState(attentionFlag);
  const [reason, setReason] = useState(attentionReason ?? "");
  const [error, setError] = useState<string | null>(null);
  // Two independent transitions, not one shared `pending` — the owner
  // Select and the attention flag/reason/Save are logically unrelated
  // controls. Sharing a single pending flag disables the whole panel
  // (including the unrelated control) for the duration of *either*
  // save, which is both a real UX defect and what made the attention
  // checkbox flake in E2E (still disabled while an owner-save's own
  // router.refresh() was in flight).
  const [ownerPending, startOwnerTransition] = useTransition();
  const [attentionPending, startAttentionTransition] = useTransition();
  const router = useRouter();

  function saveOwner(nextOwnerId: string) {
    setOwnerId(nextOwnerId);
    setError(null);
    startOwnerTransition(async () => {
      const result = await setClientSuccessOwnerAction({ companyId, userId: nextOwnerId === UNASSIGNED ? null : nextOwnerId });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function saveAttention() {
    setError(null);
    startAttentionTransition(async () => {
      const result = await setManagementAttentionFlagAction({ companyId, flag, reason: flag ? reason : null });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cs-owner">Client Success owner</Label>
        <Select value={ownerId} onValueChange={saveOwner} disabled={ownerPending}>
          <SelectTrigger id="cs-owner" className="w-full max-w-xs">
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
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={flag} onCheckedChange={(v) => setFlag(v === true)} disabled={attentionPending} />
          Flag for management attention
        </label>
        {flag ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="attention-reason">Reason (required)</Label>
            <Textarea id="attention-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={attentionPending} maxLength={1000} rows={2} />
          </div>
        ) : null}
        <Button size="sm" onClick={saveAttention} disabled={attentionPending || (flag && !reason.trim())} className="w-fit">
          Save
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
