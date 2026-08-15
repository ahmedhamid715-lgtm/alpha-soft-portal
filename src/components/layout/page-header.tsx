import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Breadcrumbs, type BreadcrumbEntry } from "./breadcrumbs"

export interface PageHeaderProps {
  title: string
  description?: string
  breadcrumbs?: BreadcrumbEntry[]
  /** Buttons/menus, right-aligned on desktop, stacked below the title on mobile. */
  actions?: ReactNode
  className?: string
}

/**
 * The top of every page body — one component, so title size, spacing, and
 * the responsive collapse from "actions beside title" to "actions below
 * title" stay identical across every module instead of each page
 * reinventing its own header markup.
 */
export function PageHeader({ title, description, breadcrumbs, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4 pb-6", className)}>
      {breadcrumbs?.length ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground max-w-2xl text-pretty">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}
