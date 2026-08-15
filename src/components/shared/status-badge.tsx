import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * The status vocabulary every module reuses instead of inventing its own
 * "chip" component per entity (ticket status, project status, invoice
 * status, ...). Deliberately "soft" (tinted background, colored text) —
 * see docs/architecture/design-system.md "Color semantics" for why solid-
 * fill badges read as louder/less premium than this restrained style.
 *
 * Accessibility: color is never the only signal — a shape (the dot) always
 * accompanies the color, and the text label is the actual status name, not
 * an icon standing in for it. See a11y §"Color is never the only indicator."
 */
const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      status: {
        neutral: "border-border bg-muted text-muted-foreground",
        success: "border-success/20 bg-success/10 text-success",
        warning: "border-warning/20 bg-warning/10 text-warning",
        destructive: "border-destructive/20 bg-destructive/10 text-destructive",
        info: "border-info/20 bg-info/10 text-info",
        primary: "border-primary/20 bg-primary/10 text-link",
      },
    },
    defaultVariants: {
      status: "neutral",
    },
  }
)

const dotVariants = cva("size-1.5 shrink-0 rounded-full", {
  variants: {
    status: {
      neutral: "bg-muted-foreground",
      success: "bg-success",
      warning: "bg-warning",
      destructive: "bg-destructive",
      info: "bg-info",
      primary: "bg-primary",
    },
  },
  defaultVariants: {
    status: "neutral",
  },
})

export interface StatusBadgeProps extends VariantProps<typeof statusBadgeVariants> {
  children: React.ReactNode
  className?: string
}

export function StatusBadge({ status, children, className }: StatusBadgeProps) {
  return (
    <span className={cn(statusBadgeVariants({ status }), className)}>
      <span className={dotVariants({ status })} aria-hidden="true" />
      {children}
    </span>
  )
}

/** Dot + label only, no pill background — for dense table cells where a full badge is too heavy. */
export function StatusDot({ status, children, className }: StatusBadgeProps) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm", className)}>
      <span className={dotVariants({ status })} aria-hidden="true" />
      {children}
    </span>
  )
}
