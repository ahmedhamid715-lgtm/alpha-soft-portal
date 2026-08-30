import { StatusBadge } from "@/components/shared/status-badge";
import { formatMoney } from "@/lib/utils/money";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { GOAL_METRIC_LABELS } from "@/lib/crm/sales-goal-metric-labels";
import { ArchiveGoalButton } from "./archive-goal-button";
import type { CrmSalesGoal } from "@/generated/prisma/client";
import type { GoalAttainment } from "@/server/services/crm-sales-performance-service";

function formatGoalValue(goal: CrmSalesGoal): string {
  if (goal.metric === "REVENUE_WON") return formatMoney(goal.valueMinorUnits ?? 0, goal.currency ?? "USD");
  if (goal.metric === "LEAD_CONVERSION_RATE") return `${goal.valuePercent}%`;
  return String(goal.valueCount ?? 0);
}

function formatActual(attainment: GoalAttainment): string {
  if (attainment.goal.metric === "REVENUE_WON") return formatMoney(attainment.actual, attainment.actualCurrency ?? "USD");
  if (attainment.goal.metric === "LEAD_CONVERSION_RATE") return `${attainment.actual}%`;
  return String(attainment.actual);
}

/** `attainments` covers ACTIVE goals only (archived goals show no attainment — their own period is over, and re-computing it isn't operationally useful). `canManage` gates the archive control. */
export function GoalList({ activeGoals, attainments, archivedGoals, canManage }: { activeGoals: CrmSalesGoal[]; attainments: Map<string, GoalAttainment>; archivedGoals: CrmSalesGoal[]; canManage: boolean }) {
  if (activeGoals.length === 0 && archivedGoals.length === 0) {
    return <p className="text-sm text-muted-foreground">No targets or quotas yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {activeGoals.map((goal) => {
        const attainment = attainments.get(goal.id);
        return (
          <div key={goal.id} className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <StatusBadge status={goal.kind === "QUOTA" ? "primary" : "info"}>{goal.kind}</StatusBadge>
                <span className="font-medium">{GOAL_METRIC_LABELS[goal.metric]}</span>
              </div>
              {canManage ? <ArchiveGoalButton goalId={goal.id} /> : null}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
              <span>
                Target: <span className="font-medium tabular-nums">{formatGoalValue(goal)}</span>
              </span>
              {attainment ? (
                <span>
                  Actual: <span className="font-medium tabular-nums">{formatActual(attainment)}</span>
                </span>
              ) : null}
              <span className="text-muted-foreground">
                {formatInTimeZone(goal.periodStart, "UTC", { month: "short", day: "numeric" })} – {formatInTimeZone(goal.periodEnd, "UTC", { month: "short", day: "numeric" })}
              </span>
            </div>
            {attainment ? (
              <span className="text-sm font-medium tabular-nums">{attainment.attainmentPercent === null ? "Attainment: Not measurable" : `Attainment: ${attainment.attainmentPercent}%`}</span>
            ) : null}
          </div>
        );
      })}
      {archivedGoals.length > 0 ? (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer select-none">{archivedGoals.length} archived goal{archivedGoals.length === 1 ? "" : "s"}</summary>
          <div className="mt-2 flex flex-col gap-2">
            {archivedGoals.map((goal) => (
              <div key={goal.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <StatusBadge status="neutral">{goal.kind}</StatusBadge>
                <span>{GOAL_METRIC_LABELS[goal.metric]}</span>
                <span className="tabular-nums">{formatGoalValue(goal)}</span>
                <span>
                  {formatInTimeZone(goal.periodStart, "UTC", { month: "short", day: "numeric" })} – {formatInTimeZone(goal.periodEnd, "UTC", { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
