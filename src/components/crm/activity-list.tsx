"use client";

import { PhoneCall, Mail, Users as MeetingIcon, StickyNote, ArrowRightLeft } from "lucide-react";
import { ActivityTimeline, type TimelineEntry } from "@/components/shared/activity-timeline";
import { EmptyState } from "@/components/shared/empty-state";
import type { CrmActivityWithActor } from "@/server/repositories/crm-activity-repository";

const TYPE_ICON = { NOTE: StickyNote, CALL: PhoneCall, EMAIL: Mail, MEETING: MeetingIcon, STATUS_CHANGE: ArrowRightLeft } as const;

const TYPE_LABEL: Record<CrmActivityWithActor["type"], string> = {
  NOTE: "left a note",
  CALL: "logged a call",
  EMAIL: "logged an email",
  MEETING: "logged a meeting",
  STATUS_CHANGE: "changed status",
};

function toTimelineEntry(activity: CrmActivityWithActor): TimelineEntry {
  const callDetail = activity.type === "CALL" && activity.callOutcome ? ` (${activity.callOutcome.toLowerCase().replace("_", " ")}${activity.callDurationSeconds ? `, ${Math.round(activity.callDurationSeconds / 60)} min` : ""})` : "";
  return {
    id: activity.id,
    actor: { name: activity.actorUser.name ?? activity.actorUser.email },
    action: `${TYPE_LABEL[activity.type]}${callDetail}`,
    timestamp: activity.occurredAt,
    icon: TYPE_ICON[activity.type],
    detail: activity.body ? <p className="text-sm text-foreground">{activity.body}</p> : undefined,
  };
}

/** Reuses the shared `ActivityTimeline` (Module 04's own component) for CRM activity feeds — see that component's own doc comment ("shared by activity feeds... and audit trails... same visual shape, different data"). */
export function CrmActivityList({ activities }: { activities: CrmActivityWithActor[] }) {
  if (activities.length === 0) {
    return <EmptyState icon={StickyNote} title="No activity logged yet" description="Notes, calls, emails, and meetings will appear here." />;
  }
  return <ActivityTimeline entries={activities.map(toTimelineEntry)} />;
}
