"use client";

import { Briefcase, FileText, Rocket, MessageSquare, type LucideIcon } from "lucide-react";
import { ActivityTimeline, type TimelineEntry } from "@/components/shared/activity-timeline";
import type { CustomerTimelineEntry } from "@/lib/crm/customer-360";

/**
 * Maps the server-composed, fully-serializable `CustomerTimelineEntry[]`
 * (plain strings/dates/numbers only — safe to pass across the server/
 * client boundary) to `ActivityTimeline`'s own `TimelineEntry[]` shape
 * HERE, client-side — not on the server page. A Lucide icon is a React
 * component (a function), and Next.js RSC cannot serialize a bare
 * function reference across that boundary (found live: "Functions
 * cannot be passed directly to Client Components"). Mirrors
 * `deal-history-list.tsx`'s own identical "do the icon mapping inside
 * the client component, not the server page" pattern from Build 20.
 */
const EVENT_ICON: Record<CustomerTimelineEntry["sourceDomain"], LucideIcon> = {
  crm_activity: MessageSquare,
  crm_deal: Briefcase,
  crm_proposal: FileText,
  crm_contract: FileText,
  crm_onboarding: Rocket,
};

export function CustomerActivityTab({ entries }: { entries: CustomerTimelineEntry[] }) {
  const timelineEntries: TimelineEntry[] = entries.map((e) => ({
    id: `${e.sourceDomain}:${e.sourceId}:${e.eventType}:${e.timestamp.toISOString()}`,
    actor: e.actor ? { name: e.actor.name } : undefined,
    action: e.summary,
    timestamp: e.timestamp,
    icon: EVENT_ICON[e.sourceDomain],
    detail: e.detail,
  }));
  return <ActivityTimeline entries={timelineEntries} />;
}
