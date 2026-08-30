"use client";

import { StickyNote, ArrowRightLeft, DollarSign, Percent, CalendarClock, UserCog, Trophy, XCircle, RotateCcw, Sparkles } from "lucide-react";
import { ActivityTimeline, type TimelineEntry } from "@/components/shared/activity-timeline";
import { EmptyState } from "@/components/shared/empty-state";
import { formatMoney } from "@/lib/utils/money";
import type { CrmDealHistoryWithActor } from "@/server/repositories/crm-deal-history-repository";

const TYPE_ICON = {
  CREATED: Sparkles,
  STAGE_CHANGED: ArrowRightLeft,
  VALUE_CHANGED: DollarSign,
  PROBABILITY_CHANGED: Percent,
  EXPECTED_CLOSE_DATE_CHANGED: CalendarClock,
  OWNER_CHANGED: UserCog,
  WON: Trophy,
  LOST: XCircle,
  REOPENED: RotateCcw,
  NOTE: StickyNote,
} as const;

function describe(entry: CrmDealHistoryWithActor): string {
  const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
  switch (entry.type) {
    case "CREATED":
      return "created this deal";
    case "STAGE_CHANGED":
      return "moved this deal to a different stage";
    case "VALUE_CHANGED": {
      const currency = typeof metadata.currency === "string" ? metadata.currency : "USD";
      const to = typeof metadata.toMinorUnits === "number" ? formatMoney(metadata.toMinorUnits, currency) : "a new value";
      return `changed the deal value to ${to}`;
    }
    case "PROBABILITY_CHANGED":
      return `changed the probability to ${metadata.to ?? "—"}%`;
    case "EXPECTED_CLOSE_DATE_CHANGED":
      return "changed the expected close date";
    case "OWNER_CHANGED":
      return "reassigned this deal";
    case "WON":
      return "marked this deal won";
    case "LOST":
      return `marked this deal lost${typeof metadata.lossReason === "string" ? `: ${metadata.lossReason}` : ""}`;
    case "REOPENED":
      return "reopened this deal";
    case "NOTE":
      return "left a note";
    default:
      return entry.type;
  }
}

/** Reuses the shared `ActivityTimeline` (same reuse `crm-activity-list.tsx` — Build 19 — already established) for the deal's own business chronology — see sales-pipeline.md "Deal history." */
export function DealHistoryList({ entries }: { entries: CrmDealHistoryWithActor[] }) {
  if (entries.length === 0) {
    return <EmptyState icon={StickyNote} title="No history yet" />;
  }

  const timelineEntries: TimelineEntry[] = entries.map((entry) => ({
    id: entry.id,
    actor: { name: entry.actorUser.name ?? entry.actorUser.email },
    action: describe(entry),
    timestamp: entry.occurredAt,
    icon: TYPE_ICON[entry.type],
    detail: entry.type === "NOTE" && entry.note ? <p className="text-sm text-foreground">{entry.note}</p> : undefined,
  }));

  return <ActivityTimeline entries={timelineEntries} />;
}
