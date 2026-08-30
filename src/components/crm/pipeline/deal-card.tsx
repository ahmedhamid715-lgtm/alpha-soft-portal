"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Building2, User as UserIcon, CalendarClock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney } from "@/lib/utils/money";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { moveDealStageAction } from "@/app/(protected)/admin/crm/actions";
import type { CrmDealWithRelations } from "@/server/repositories/crm-deal-repository";

/**
 * One deal, in one stage column. `select` (always visible, always
 * keyboard-operable) is the PRIMARY move control, not a hidden
 * fallback — native HTML5 drag is a progressive enhancement on top of
 * it, both call the exact same `moveDealStageAction()`. The server
 * (`crm-deal-service.ts`'s own `moveDealStage()`, plus the DB
 * relationship-integrity trigger) is the real authority: dragging a
 * card, or forging a `stageId` directly, never grants a move by itself
 * — a rejected move is reported via a toast and the board simply
 * refreshes to the real, unmoved state (no client-guessed optimistic
 * state to roll back — see `pipeline-board.tsx`'s own top comment).
 */
export function DealCard({
  deal,
  stageOptions,
  canManage,
  onDragStart,
}: {
  deal: CrmDealWithRelations;
  stageOptions: { id: string; name: string }[];
  canManage: boolean;
  onDragStart?: (dealId: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleMove(stageId: string) {
    if (stageId === deal.stageId) return;
    startTransition(async () => {
      const result = await moveDealStageAction({ dealId: deal.id, stageId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card
      draggable={canManage}
      onDragStart={(e) => {
        if (!canManage) return;
        e.dataTransfer.setData("text/plain", deal.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.(deal.id);
      }}
      className={pending ? "opacity-60" : undefined}
    >
      <CardContent className="flex flex-col gap-2">
        <Link href={`/admin/crm/deals/${deal.id}`} className="text-sm font-medium hover:underline">
          {deal.title}
        </Link>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
          {deal.company.name}
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold tabular-nums">{formatMoney(deal.valueMinorUnits, deal.currency)}</span>
          {deal.probability !== null ? <span className="text-xs text-muted-foreground tabular-nums">{deal.probability}%</span> : null}
        </div>
        {deal.expectedCloseDate ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
            {formatInTimeZone(deal.expectedCloseDate, "UTC", { month: "short", day: "numeric", year: "numeric" })}
          </div>
        ) : null}
        {deal.assignedToUser ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <UserIcon className="size-3.5 shrink-0" aria-hidden="true" />
            {deal.assignedToUser.name}
          </div>
        ) : null}
        {canManage && stageOptions.length > 0 ? (
          <Select value={deal.stageId} onValueChange={handleMove} disabled={pending}>
            <SelectTrigger size="sm" aria-label={`Move "${deal.title}" to a different stage`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stageOptions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </CardContent>
    </Card>
  );
}
