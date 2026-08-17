"use client"

import { useSyncExternalStore } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export interface TimelineEntry {
  id: string
  /** Rendered as prose: "{actor} {action}" — e.g. actor="Sarah Chen", action="changed status to In Progress". */
  actor?: { name: string; avatarUrl?: string }
  action: string
  timestamp: Date
  icon?: LucideIcon
  /** Extra detail below the action line — e.g. a before/after diff for an audit entry, a comment body. */
  detail?: React.ReactNode
}

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

function formatRelativeTime(date: Date): string {
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000)
  const thresholds: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [2629800, "week"],
    [31557600, "month"],
    [Infinity, "year"],
  ]
  const divisors: Record<string, number> = {
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86400,
    week: 604800,
    month: 2629800,
    year: 31557600,
  }
  const [, unit] = thresholds.find(([limit]) => Math.abs(diffSeconds) < limit) ?? [Infinity, "year"]
  return relativeFormatter.format(Math.round(diffSeconds / divisors[unit]), unit)
}

function subscribeNever() {
  return () => {}
}

/**
 * `formatRelativeTime` measures against `Date.now()` at render time — the
 * exact anti-pattern React's own hydration warning calls out ("Date.now()
 * ... which changes each time it's called"). Server-render and
 * client-hydrate happen at two different real moments, so the computed
 * label can differ between them. The fix is the standard one: render a
 * deterministic, prop-only value (derived purely from `date`, no wall-clock
 * read) for the SSR-matched first paint, then swap to the real relative
 * label once mounted — a one-way client-side update, not a mismatch.
 */
/** Exported for reuse outside this file (Module 09's notification list/bell — see `docs/architecture/notifications.md` "reuse" table) rather than duplicating the hydration-safe relative-time pattern. */
export function useRelativeTime(date: Date): string {
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false)
  if (!mounted) return date.toISOString().slice(0, 10)
  return formatRelativeTime(date)
}

/**
 * Shared by activity feeds (project activity, ticket history) and audit
 * trails (Module 08) — same visual shape, different data. A dedicated
 * "AuditTimeline" component would just be this with `detail` populated
 * from before/after values, so it isn't a separate component.
 */
export function ActivityTimeline({ entries, className }: { entries: TimelineEntry[]; className?: string }) {
  return (
    <ol className={cn("flex flex-col", className)}>
      {entries.map((entry, index) => {
        const Icon = entry.icon
        const isLast = index === entries.length - 1
        return <TimelineRow key={entry.id} entry={entry} icon={Icon} isLast={isLast} />
      })}
    </ol>
  )
}

function TimelineRow({ entry, icon: Icon, isLast }: { entry: TimelineEntry; icon?: LucideIcon; isLast: boolean }) {
  const relativeTime = useRelativeTime(entry.timestamp)
  return (
    <li className="relative flex gap-3 pb-6 last:pb-0">
      {!isLast ? <span className="absolute top-8 left-4 h-[calc(100%-1.75rem)] w-px bg-border" aria-hidden="true" /> : null}
      {entry.actor ? (
        <Avatar className="size-8 shrink-0 border border-border">
          <AvatarImage src={entry.actor.avatarUrl} alt="" />
          <AvatarFallback className="text-xs">{initials(entry.actor.name)}</AvatarFallback>
        </Avatar>
      ) : (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
          {Icon ? <Icon className="size-4 text-muted-foreground" aria-hidden="true" /> : null}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
        <p className="text-sm">
          {entry.actor ? <span className="font-medium">{entry.actor.name} </span> : null}
          <span className="text-muted-foreground">{entry.action}</span>
        </p>
        {entry.detail}
        <time dateTime={entry.timestamp.toISOString()} className="text-xs text-muted-foreground">
          {relativeTime}
        </time>
      </div>
    </li>
  )
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}
