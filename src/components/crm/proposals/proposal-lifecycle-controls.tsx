"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { sendProposalAction, submitProposalForApprovalAction, rejectProposalAction, expireProposalAction } from "@/app/(protected)/admin/crm/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { CrmProposal, CrmProposalVersion } from "@/generated/prisma/client";

/**
 * The DRAFT/SENT-side lifecycle actions for `crm.proposal.manage`
 * holders — submit for approval, send, record a customer rejection,
 * mark expired, and a link to start a revision. Approval DECISIONS live
 * in `ProposalApprovalControls` (a separate, narrower `crm.proposal.approve`
 * permission — see permissions.ts's own comment) and acceptance in
 * `ProposalAcceptForm` — kept as distinct components since they're
 * gated by distinct permissions, mirroring `DealLifecycleControls`'s own
 * "one component, one permission boundary" shape.
 */
export function ProposalLifecycleControls({ proposal, version }: { proposal: CrmProposal; version: CrmProposalVersion | null }) {
  const [showRejectForm, setShowRejectForm] = useState(false);
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
      setShowRejectForm(false);
      setReason("");
      router.refresh();
    });
  }

  if (!version) return null;

  return (
    <div className="flex flex-col gap-3">
      {version.status === "DRAFT" ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/admin/crm/proposals/${proposal.id}/edit`}>Edit draft</Link>
          </Button>
          {version.approvalStatus === "NOT_REQUIRED" ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => runAction(() => submitProposalForApprovalAction({ proposalId: proposal.id }))}>
              Submit for approval
            </Button>
          ) : null}
          {version.approvalStatus === "NOT_REQUIRED" || version.approvalStatus === "APPROVED" ? (
            <div className="flex flex-col gap-1">
              <Button size="sm" disabled={pending} onClick={() => runAction(() => sendProposalAction({ proposalId: proposal.id }))}>
                Mark as sent
              </Button>
              {/* Alpha OS has no outbound email/delivery infrastructure
                  for this domain (see proposals-contracts.md) — this only
                  freezes the version and records that it was sent; the
                  staff member still delivers it themselves (print view,
                  email, etc.). Never word this as though Alpha OS itself
                  delivers the proposal. */}
              <p className="text-xs text-muted-foreground">Freezes this version and records it as sent — deliver it to the customer yourself (e.g. the print view) first.</p>
            </div>
          ) : null}
          {version.approvalStatus === "PENDING" ? <p className="self-center text-sm text-muted-foreground">Awaiting internal approval before this can be sent.</p> : null}
        </div>
      ) : null}

      {version.status === "SENT" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setShowRejectForm(true)}>
              Record customer rejection
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => runAction(() => expireProposalAction({ proposalId: proposal.id }))}>
              Mark expired
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/admin/crm/proposals/${proposal.id}/revise`}>Revise (new version)</Link>
            </Button>
          </div>
          {showRejectForm ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="proposal-reject-reason">Rejection reason</Label>
              <Textarea id="proposal-reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} disabled={pending} />
              <div className="flex gap-2">
                <Button size="sm" disabled={pending || !reason.trim()} onClick={() => runAction(() => rejectProposalAction({ proposalId: proposal.id, reason }))}>
                  Confirm rejection
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setShowRejectForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {version.status === "REJECTED" || version.status === "EXPIRED" ? (
        <Button asChild size="sm" variant="outline" className="w-fit">
          <Link href={`/admin/crm/proposals/${proposal.id}/revise`}>Revise (new version)</Link>
        </Button>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
