"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideProposalApprovalAction } from "@/app/(protected)/admin/crm/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { CrmProposalVersion } from "@/generated/prisma/client";

/**
 * `crm.proposal.approve` only — a SEPARATE permission from
 * `crm.proposal.manage` specifically so this control isn't reachable by
 * every proposal author (see permissions.ts's own comment). The page
 * that renders this component is also responsible for the self-approval
 * check's OWN visibility (hiding this from the submitter) as a UX
 * courtesy; the real enforcement is server-side in
 * `decideProposalApproval()`, which rejects the call outright even if
 * this component were somehow rendered for the wrong user.
 */
export function ProposalApprovalControls({ proposalId, version }: { proposalId: string; version: CrmProposalVersion }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (version.approvalStatus !== "PENDING") return null;

  function decide(approved: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await decideProposalApprovalAction({ proposalId, approved, note: note || undefined });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
      <p className="text-sm font-medium">Approval requested</p>
      <Label htmlFor="approval-note" className="text-xs text-muted-foreground">
        Note (optional)
      </Label>
      <Textarea id="approval-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} disabled={pending} />
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => decide(true)}>
          Approve
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => decide(false)}>
          Reject
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
