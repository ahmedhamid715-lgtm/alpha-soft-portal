"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeLeadStatusAction } from "@/app/(protected)/admin/crm/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { CrmLeadStatus } from "@/generated/prisma/client";

const VALID_TRANSITIONS: Record<CrmLeadStatus, CrmLeadStatus[]> = {
  NEW: ["CONTACTED", "QUALIFIED", "DISQUALIFIED"],
  CONTACTED: ["QUALIFIED", "DISQUALIFIED"],
  QUALIFIED: ["CONVERTED", "DISQUALIFIED"],
  CONVERTED: [],
  DISQUALIFIED: [],
};

/** Mirrors `crm-lead-service.ts`'s own `VALID_TRANSITIONS` — this copy only decides which buttons to SHOW; the service re-enforces the same rule authoritatively (a stale/forged client request that skips this UI entirely still gets rejected there). */
export function LeadStatusForm({ leadId, currentStatus }: { leadId: string; currentStatus: CrmLeadStatus }) {
  const [disqualifyReason, setDisqualifyReason] = useState("");
  const [showDisqualifyForm, setShowDisqualifyForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const nextStatuses = VALID_TRANSITIONS[currentStatus];
  if (nextStatuses.length === 0) return null;

  function handleTransition(status: CrmLeadStatus, disqualifiedReason?: string) {
    setError(null);
    startTransition(async () => {
      const result = await changeLeadStatusAction({ leadId, status, disqualifiedReason });
      if (result.error) {
        setError(result.error);
        return;
      }
      setShowDisqualifyForm(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {nextStatuses.map((status) =>
          status === "DISQUALIFIED" ? (
            <Button key={status} variant="outline" size="sm" disabled={pending} onClick={() => setShowDisqualifyForm(true)}>
              Disqualify
            </Button>
          ) : (
            <Button key={status} variant="outline" size="sm" disabled={pending} onClick={() => handleTransition(status)}>
              Mark {status.toLowerCase()}
            </Button>
          ),
        )}
      </div>
      {showDisqualifyForm ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="disqualify-reason">Reason</Label>
          <Textarea id="disqualify-reason" value={disqualifyReason} onChange={(e) => setDisqualifyReason(e.target.value)} rows={2} maxLength={1000} disabled={pending} />
          <div className="flex gap-2">
            <Button size="sm" disabled={pending || !disqualifyReason.trim()} onClick={() => handleTransition("DISQUALIFIED", disqualifyReason)}>
              Confirm disqualify
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setShowDisqualifyForm(false)}>
              Cancel
            </Button>
          </div>
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
