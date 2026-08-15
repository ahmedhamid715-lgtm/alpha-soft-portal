"use client"

import type { ReactNode } from "react"
import { AppSidebar, type NavGroup } from "./app-sidebar"
import { TopNav } from "./top-nav"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export interface AppShellProps {
  roleLabel: string
  navGroups: NavGroup[]
  sidebarFooter?: ReactNode
  topNavEnd?: ReactNode
  onSearchClick?: () => void
  children: ReactNode
}

/**
 * The one application shell every role's dashboard mounts inside —
 * sidebar + top bar + content region, with collapse/expand and mobile
 * behavior handled entirely by the underlying Sidebar primitive (see
 * app-sidebar.tsx). Nothing here knows about admin/support/customer;
 * that distinction lives entirely in the `navGroups` a page passes in.
 *
 * `SidebarProvider` persists collapsed/expanded state in a cookie
 * (`sidebar_state`, 7-day) via the underlying primitive, so the choice
 * survives a reload — not implemented in this file, inherited for free.
 */
export function AppShell({ roleLabel, navGroups, sidebarFooter, topNavEnd, onSearchClick, children }: AppShellProps) {
  return (
    <SidebarProvider>
      <AppSidebar roleLabel={roleLabel} groups={navGroups} footer={sidebarFooter} />
      <SidebarInset>
        <TopNav onSearchClick={onSearchClick} end={topNavEnd} />
        {/*
         * A plain `div`, not `<main>` — `SidebarInset` (above) already
         * renders the page's one `<main>` landmark; a second `<main>` here
         * was a real duplicate-landmark violation (axe: landmark-no-
         * duplicate-main / landmark-main-is-top-level).
         *
         * `@container`: the sidebar is fixed-width and its own state
         * (expanded/collapsed/off-canvas) isn't reflected in the viewport
         * width, so a child grid keyed to viewport breakpoints (`sm:`,
         * `lg:`) can decide there's room for N columns when the sidebar has
         * actually left less space than that — content overflows and the
         * whole page gets a horizontal scrollbar. Marking this element a
         * container lets descendants use `@sm:`/`@lg:`/etc. instead, sized
         * against the space actually available next to the sidebar.
         */}
        <div className="@container flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
