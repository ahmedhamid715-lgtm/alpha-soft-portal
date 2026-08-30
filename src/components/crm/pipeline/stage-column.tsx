"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DealCard } from "./deal-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatMoney } from "@/lib/utils/money";
import { moveDealStageAction } from "@/app/(protected)/admin/crm/actions";
import { cn } from "@/lib/utils";
import type { CrmDealWithRelations } from "@/server/repositories/crm-deal-repository";
import type { CrmPipelineStage } from "@/generated/prisma/client";

/** One pipeline stage's own column — deal count + total value in its own currency groups (never blended), drop target for native drag, and the shared deal-card list. */
export function StageColumn({
  stage,
  deals,
  allActiveStages,
  canManage,
}: {
  stage: CrmPipelineStage;
  deals: CrmDealWithRelations[];
  allActiveStages: CrmPipelineStage[];
  canManage: boolean;
}) {
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const totalsByCurrency = new Map<string, number>();
  for (const deal of deals) totalsByCurrency.set(deal.currency, (totalsByCurrency.get(deal.currency) ?? 0) + deal.valueMinorUnits);

  const stageOptions = allActiveStages.filter((s) => !s.isWon && !s.isLost && s.id !== stage.id).map((s) => ({ id: s.id, name: s.name }));

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setIsDropTarget(false);
    if (!canManage || stage.isWon || stage.isLost) return;
    const dealId = event.dataTransfer.getData("text/plain");
    if (!dealId) return;
    startTransition(async () => {
      const result = await moveDealStageAction({ dealId, stageId: stage.id });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      className={cn("flex w-72 shrink-0 flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3", isDropTarget && "border-primary bg-primary/5", pending && "opacity-70")}
      onDragOver={(e) => {
        if (!canManage || stage.isWon || stage.isLost) return;
        e.preventDefault();
        setIsDropTarget(true);
      }}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={handleDrop}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{stage.name}</span>
          {stage.isWon ? <StatusBadge status="success">Won</StatusBadge> : stage.isLost ? <StatusBadge status="destructive">Lost</StatusBadge> : null}
        </div>
        <div className="flex flex-col text-xs text-muted-foreground tabular-nums">
          <span>
            {deals.length} deal{deals.length === 1 ? "" : "s"}
          </span>
          {[...totalsByCurrency.entries()].map(([currency, total]) => (
            <span key={currency}>{formatMoney(total, currency)}</span>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} stageOptions={stageOptions} canManage={canManage} />
        ))}
      </div>
    </div>
  );
}
