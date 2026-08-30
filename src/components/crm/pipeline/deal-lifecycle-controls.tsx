"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { winDealAction, loseDealAction, reopenDealAction, moveDealStageAction } from "@/app/(protected)/admin/crm/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CrmDeal, CrmPipelineStage } from "@/generated/prisma/client";

/**
 * The deal's own lifecycle controls — the accessible, always-present
 * counterpart to the board's own move-select (`deal-card.tsx`), reached
 * directly from a deal's own detail page rather than only from the
 * board. Every action here calls the same service functions the board
 * does; nothing here is a separate authorization path.
 */
export function DealLifecycleControls({ deal, stages }: { deal: CrmDeal; stages: CrmPipelineStage[] }) {
  const [showLoseForm, setShowLoseForm] = useState(false);
  const [lossReason, setLossReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const openStages = stages.filter((s) => !s.isWon && !s.isLost);

  function runAction(fn: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        setError(result.error);
        return;
      }
      setShowLoseForm(false);
      setLossReason("");
      router.refresh();
    });
  }

  if (deal.status !== "OPEN") {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="outline" size="sm" disabled={pending} onClick={() => runAction(() => reopenDealAction({ dealId: deal.id }))}>
          Reopen deal
        </Button>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {openStages.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deal-stage-move">Stage</Label>
          <Select value={deal.stageId} onValueChange={(stageId) => runAction(() => moveDealStageAction({ dealId: deal.id, stageId }))} disabled={pending}>
            <SelectTrigger id="deal-stage-move" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {openStages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => runAction(() => winDealAction({ dealId: deal.id }))}>
          Mark won
        </Button>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => setShowLoseForm(true)}>
          Mark lost
        </Button>
      </div>

      {showLoseForm ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="loss-reason">Loss reason</Label>
          <Textarea id="loss-reason" value={lossReason} onChange={(e) => setLossReason(e.target.value)} rows={2} maxLength={1000} disabled={pending} />
          <div className="flex gap-2">
            <Button size="sm" disabled={pending || !lossReason.trim()} onClick={() => runAction(() => loseDealAction({ dealId: deal.id, lossReason }))}>
              Confirm lost
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setShowLoseForm(false)}>
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
