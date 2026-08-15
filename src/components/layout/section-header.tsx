import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface SectionHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}

/** One notch down from PageHeader — for a labeled block within a page, not the page itself. */
export function SectionHeader({ title, description, actions, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
