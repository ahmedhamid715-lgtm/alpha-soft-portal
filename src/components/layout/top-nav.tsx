"use client"

import type { ReactNode } from "react"
import { Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/theme-toggle"

export interface TopNavProps {
  /** Opens the command palette — wired by the page/shell that owns CommandPalette's open state. */
  onSearchClick?: () => void
  /** User menu, notifications bell, etc. — role-specific, so injected rather than owned here. */
  end?: ReactNode
  children?: ReactNode
}

/**
 * The persistent top bar inside SidebarInset. Owns only the chrome that's
 * identical everywhere (sidebar toggle, search trigger, theme toggle) —
 * everything role-specific comes in through `end`.
 */
export function TopNav({ onSearchClick, end, children }: TopNavProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/75">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-1 h-5" />
      <div className="min-w-0 flex-1">{children}</div>
      {onSearchClick ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onSearchClick}
          className="hidden text-muted-foreground sm:inline-flex"
        >
          <Search />
          Search
          <kbd className="ml-2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </Button>
      ) : null}
      {onSearchClick ? (
        <Button variant="outline" size="icon" onClick={onSearchClick} aria-label="Search" className="sm:hidden">
          <Search />
        </Button>
      ) : null}
      <ThemeToggle />
      {end}
    </header>
  )
}
