import type { LucideIcon } from "lucide-react"
import { AlertTriangle, Inbox } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface StateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

/** No records / no results yet — distinct from ErrorState, which is "something went wrong." */
export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: StateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center",
        className
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="text-sm text-muted-foreground max-w-sm">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

/** Something failed — a query, a submission, a load. Always offer a way forward via `action` (e.g. Retry). */
export function ErrorState({ icon: Icon = AlertTriangle, title, description, action, className }: StateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-6 py-16 text-center",
        className
      )}
      role="alert"
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10">
        <Icon className="size-5 text-destructive" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="text-sm text-muted-foreground max-w-sm">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}
