"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createContractFromProposalAction, createManualContractAction } from "@/app/(protected)/admin/crm/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function NewContractForm({ source }: { source: { type: "proposal"; proposalId: string } | { type: "manual"; dealId: string } }) {
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [renewalTerms, setRenewalTerms] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const payload = { effectiveDate: effectiveDate || undefined, endDate: endDate || undefined, renewalTerms: renewalTerms || undefined };
      const result = source.type === "proposal" ? await createContractFromProposalAction({ proposalId: source.proposalId, ...payload }) : await createManualContractAction({ dealId: source.dealId, ...payload });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.data) router.push(`/admin/crm/contracts/${result.data.id}`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contract-effective-date">Effective date</Label>
          <Input id="contract-effective-date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} disabled={pending} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contract-end-date">End date (optional)</Label>
          <Input id="contract-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={pending} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contract-renewal-terms">Renewal terms (optional)</Label>
        <Textarea id="contract-renewal-terms" value={renewalTerms} onChange={(e) => setRenewalTerms(e.target.value)} rows={2} maxLength={2000} disabled={pending} placeholder="e.g. Auto-renews annually unless 30 days' written notice is given." />
      </div>
      <Button onClick={handleSubmit} disabled={pending} className="w-fit">
        Create contract
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
