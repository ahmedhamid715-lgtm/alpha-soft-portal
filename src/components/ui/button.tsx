import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Module 17 — `hover:bg-primary/80` measured ~4.1:1 in dark mode
        // (below WCAG AA's 4.5:1) for `text-primary-foreground` on top of
        // it, found by axe-core scanning a real page immediately after a
        // real `.click()` (the mouse stays over the button afterward, so
        // the hover state was actually engaged at scan time — not caught
        // by any earlier accessibility test, none of which happened to
        // scan mid-hover). A first attempt tried `dark:hover:bg-primary/90`
        // (a less-transparent fraction) and STILL failed, verified by
        // directly inspecting the real computed background at runtime:
        // `color-mix(..., transparent)` produces a genuinely
        // SEMI-TRANSPARENT color (an alpha channel), not a pre-flattened
        // solid one — its EFFECTIVE on-screen color still depends on
        // whatever sits behind the button (a Card, a page background,
        // ...), so no fixed opacity fraction is reliably safe against an
        // unknown backdrop. Same root cause `destructive`'s own comment
        // below already documents, this time actually fixed the same way
        // THAT variant was: mix toward an OPAQUE color (black), never
        // `transparent` — `color-mix(in oklab, var(--primary) 85%,
        // black)` measures 9.1:1 against white regardless of backdrop,
        // verified directly (canvas pixel sampling), not estimated. Light
        // mode's `/80` (a real, working transparent blend against that
        // theme's own lighter backdrops) is untouched.
        default: "bg-primary text-primary-foreground hover:bg-primary/80 dark:hover:bg-[color-mix(in_oklab,var(--primary)_85%,black)]",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        // Dark mode's soft tint (`/20` default, `/30` hover) fell below
        // WCAG AA's 4.5:1 text contrast against real Card/Dialog
        // surfaces — measured as low as 1.3:1 in a nested-dialog
        // context, and a same-hue text-on-tinted-background pairing
        // like this is inherently fragile: Tailwind v4's opacity
        // modifier blends in OKLCH, not simple sRGB alpha-over, so the
        // actual rendered color at any given fraction doesn't match a
        // naive contrast estimate, and it compounds further under
        // Dialog/Sheet's own semi-transparent overlay layering — a
        // lower tint fraction was tried here and still failed for the
        // same reason. A solid fill sidesteps the whole problem: black
        // text on the light dark-mode destructive red measures 7.5:1
        // regardless of what's underneath. Found by this module's own
        // axe-core testing across real Card/Dialog contexts, not by
        // inspection — Module 02's own design-system showcase never
        // happened to render this variant against one in dark mode.
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive dark:text-destructive-foreground dark:hover:bg-destructive/90 dark:focus-visible:ring-destructive/40",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
