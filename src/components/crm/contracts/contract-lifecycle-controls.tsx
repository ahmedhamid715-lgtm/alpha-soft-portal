"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { activateContractAction, terminateContractAction, cancelContractAction, expireContractAction } from "@/app/(protected)/admin/crm/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { CrmContract } from "@/generated/prisma/client";

/** `crm.contract.manage` — DRAFT -> ACTIVE -> (TERMINATED | EXPIRED); DRAFT -> CANCELLED. Mirrors `DealLifecycleControls`'s own `runAction()` shape. */
export function ContractLifecycleControls({ contract }: { contract: CrmContract }) {
  const [showTerminateForm, setShowTerminateForm] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function runAction(fn: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        setError(result.error);
        return;
      }
      setShowTerminateForm(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {contract.status === "DRAFT" ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={pending} onClick={() => runAction(() => activateContractAction({ contractId: contract.id }))}>
            Activate
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => runAction(() => cancelContractAction({ contractId: contract.id }))}>
            Cancel
          </Button>
        </div>
      ) : null}

      {contract.status === "ACTIVE" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setShowTerminateForm(true)}>
              Terminate
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => runAction(() => expireContractAction({ contractId: contract.id }))}>
              Mark expired
            </Button>
          </div>
          {showTerminateForm ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="contract-terminate-reason">Termination reason</Label>
              <Textarea id="contract-terminate-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} disabled={pending} />
              <div className="flex gap-2">
                <Button size="sm" disabled={pending || !reason.trim()} onClick={() => runAction(() => terminateContractAction({ contractId: contract.id, reason }))}>
                  Confirm termination
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setShowTerminateForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
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
