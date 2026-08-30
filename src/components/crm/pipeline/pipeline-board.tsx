import { StageColumn } from "./stage-column";
import { EmptyState } from "@/components/shared/empty-state";
import { KanbanSquare } from "lucide-react";
import type { CrmDealWithRelations } from "@/server/repositories/crm-deal-repository";
import type { CrmPipelineStage } from "@/generated/prisma/client";

/**
 * The Kanban board — a plain horizontally-scrolling row of
 * `StageColumn`s (`overflow-x-auto` on its own container, never the
 * page body — see design-system conventions). Deliberately NOT
 * client-side "optimistic": every move (drag or the accessible select)
 * calls the server, awaits the real result, then either shows the error
 * (`sonner` toast) or refreshes to the confirmed state — see
 * `deal-card.tsx`'s own top comment. This avoids the classic optimistic-
 * UI reconciliation bug surface entirely rather than building it and
 * then defending it; Sales Pipeline mutations are fast enough (sub-
 * second, real Postgres transactions) for this to feel immediate in
 * practice. On narrow viewports the row still scrolls horizontally by
 * touch/trackpad — every column's own accessible "Move to…" select
 * remains the primary, always-reachable way to move a card regardless
 * of viewport or input method (spec's own "mobile must remain usable").
 */
export function PipelineBoard({ stages, dealsByStage, canManage }: { stages: CrmPipelineStage[]; dealsByStage: Map<string, CrmDealWithRelations[]>; canManage: boolean }) {
  if (stages.length === 0) {
    return <EmptyState icon={KanbanSquare} title="This pipeline has no stages yet" description="Add a stage in pipeline settings before creating deals." />;
  }

  return (
    <div className="overflow-x-auto pb-2" tabIndex={0} role="region" aria-label="Sales pipeline board, scrollable on narrow viewports">
      <div className="flex gap-4">
        {stages.map((stage) => (
          <StageColumn key={stage.id} stage={stage} deals={dealsByStage.get(stage.id) ?? []} allActiveStages={stages} canManage={canManage} />
        ))}
      </div>
    </div>
  );
}
