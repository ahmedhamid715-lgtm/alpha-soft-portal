"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createRenewalAction, startRenewalAction, closeRenewalAction } from "@/app/(protected)/admin/crm/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw } from "lucide-react";
import type { CrmClientSuccessRenewalStatus } from "@/generated/prisma/client";
import type { CrmClientSuccessRenewalWithRelations } from "@/server/repositories/crm-client-success-renewal-repository";

const RENEWAL_STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "info" | "neutral"> = {
  UPCOMING: "neutral",
  IN_PROGRESS: "info",
  RENEWED: "success",
  NOT_RENEWING: "destructive",
  EXPIRED: "destructive",
};

function fmtDate(date: Date): string {
  return new Date(date).toISOString().slice(0, 10);
}

/** Eligible contracts are those with NO open renewal already tracking them — passed in by the server page, never re-derived client-side. */
export function ClientSuccessRenewals({ companyId, renewals, eligibleContracts }: { companyId: string; renewals: CrmClientSuccessRenewalWithRelations[]; eligibleContracts: { id: string; contractNumber: string; endDate: Date | null }[] }) {
  const [contractId, setContractId] = useState("");
  const [renewalDate, setRenewalDate] = useState("");
  const [closing, setClosing] = useState<{ renewalId: string; status: CrmClientSuccessRenewalStatus } | null>(null);
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function createRenewal() {
    if (!contractId) return;
    setError(null);
    startTransition(async () => {
      const result = await createRenewalAction({ companyId, contractId, renewalDate: renewalDate || undefined });
      if (result.error) {
        setError(result.error);
        return;
      }
      setContractId("");
      setRenewalDate("");
      router.refresh();
    });
  }

  function start(renewalId: string) {
    startTransition(async () => {
      const result = await startRenewalAction({ renewalId });
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  function confirmClose() {
    if (!closing || !outcome.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await closeRenewalAction({ renewalId: closing.renewalId, status: closing.status, outcome });
      if (result.error) {
        setError(result.error);
        return;
      }
      setClosing(null);
      setOutcome("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {eligibleContracts.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="renewal-contract">Contract</Label>
            <Select value={contractId} onValueChange={setContractId} disabled={pending}>
              <SelectTrigger id="renewal-contract" className="w-56">
                <SelectValue placeholder="Select a contract" />
              </SelectTrigger>
              <SelectContent>
                {eligibleContracts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.contractNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="renewal-date">Renewal date (defaults to contract end date)</Label>
            <Input id="renewal-date" type="date" value={renewalDate} onChange={(e) => setRenewalDate(e.target.value)} disabled={pending} />
          </div>
          <Button size="sm" onClick={createRenewal} disabled={pending || !contractId}>
            Start tracking renewal
          </Button>
        </div>
      ) : null}

      {renewals.length === 0 ? (
        <EmptyState icon={RefreshCw} title="No renewals tracked" description="Start tracking a renewal for an active contract above." />
      ) : (
        <div className="flex flex-col gap-2">
          {renewals.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {r.contract.contractNumber} — target {fmtDate(r.renewalDate)}
                    </span>
                    <span className="text-xs text-muted-foreground">{r.ownerUser ? `Owner: ${r.ownerUser.name}` : "Unassigned"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={RENEWAL_STATUS_TONE[r.status]}>{r.status.replace("_", " ")}</StatusBadge>
                    {r.status === "UPCOMING" ? (
                      <Button size="sm" variant="outline" onClick={() => start(r.id)} disabled={pending}>
                        Start
                      </Button>
                    ) : null}
                    {r.status === "UPCOMING" || r.status === "IN_PROGRESS" ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setClosing({ renewalId: r.id, status: "RENEWED" })} disabled={pending}>
                          Renewed
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setClosing({ renewalId: r.id, status: "NOT_RENEWING" })} disabled={pending}>
                          Not renewing
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
                {closing?.renewalId === r.id ? (
                  <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                    <Label htmlFor={`outcome-${r.id}`}>Outcome note (required)</Label>
                    <Textarea id={`outcome-${r.id}`} value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={2} maxLength={2000} disabled={pending} />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={pending || !outcome.trim()} onClick={confirmClose}>
                        Confirm {closing.status === "RENEWED" ? "renewed" : "not renewing"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setClosing(null);
                          setOutcome("");
                        }}
                        disabled={pending}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
