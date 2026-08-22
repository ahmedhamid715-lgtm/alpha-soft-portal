import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export interface MetricCardProps {
  label: string
  value: string
  /** Signed percentage or delta text, e.g. "+12.4%" or "-3 this week". */
  change?: string
  trend?: "up" | "down" | "neutral"
  icon?: LucideIcon
  /** An optional small affordance rendered next to the label — e.g. an info-icon tooltip explaining exactly what this metric measures (Module 15's own `MetricInfo`). Renders nothing extra when omitted, so every existing caller is unaffected. */
  info?: ReactNode
  className?: string
}

/**
 * The dashboard number tile — revenue, MRR, open tickets, active
 * projects. One component so every metric across Admin/Support/Customer
 * dashboards renders identically instead of each page rolling its own
 * card.
 *
 * Trend color follows semantic meaning, not just direction: `trend="up"`
 * is framed positive (success) and `"down"` negative (destructive) by
 * default, but callers should still pass whichever `trend` value is
 * actually favorable for that metric — e.g. a support queue's open-ticket
 * count going up is bad news despite being numerically "up," so pass
 * `trend="down"` there for the correct color even though the arrow still
 * points up via `change` text.
 */
export function MetricCard({ label, value, change, trend = "neutral", icon: Icon, info, className }: MetricCardProps) {
  return (
    <Card className={cn("gap-3", className)}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-0">
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          {label}
          {info}
        </span>
        {Icon ? <Icon className="size-4 text-muted-foreground" aria-hidden="true" /> : null}
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
          {change ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-xs font-medium",
                trend === "up" && "text-success",
                trend === "down" && "text-destructive",
                trend === "neutral" && "text-muted-foreground"
              )}
            >
              {trend === "up" ? (
                <ArrowUp className="size-3" aria-hidden="true" />
              ) : trend === "down" ? (
                <ArrowDown className="size-3" aria-hidden="true" />
              ) : null}
              {change}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export function MetricCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn("gap-3", className)}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-0">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-4 rounded" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-28" />
      </CardContent>
    </Card>
  )
}
