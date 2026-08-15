"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { appConfig } from "@/config/app"
import type { NavItem } from "@/config/navigation"
import { resolveNavIcon } from "./nav-icons"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

export interface NavGroup {
  /** Omit for a group with no visible heading. */
  label?: string
  items: NavItem[]
}

export interface AppSidebarProps {
  /** e.g. "Admin", "Support", "Customer" — the role this shell instance represents. */
  roleLabel: string
  groups: NavGroup[]
  /** Rendered at the bottom of the sidebar — user menu, workspace switcher, etc. */
  footer?: React.ReactNode
}

/**
 * Renders whatever `groups` it's given — it has no knowledge of "admin"
 * vs "support" vs "customer" navigation. Each role-specific module (09
 * Admin Command Center, 32 Support Team, 20 Customer Portal) supplies its
 * own `NavGroup[]`; this component is purely the rendering + active-state
 * + collapse/expand + mobile machinery, reused across all three.
 */
export function AppSidebar({ roleLabel, groups, footer }: AppSidebarProps) {
  const pathname = usePathname()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            A
          </div>
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold leading-tight">{appConfig.name}</span>
            <span className="truncate text-xs text-muted-foreground leading-tight">{roleLabel}</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group, groupIndex) => (
          <SidebarGroup key={group.label ?? groupIndex}>
            {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <NavMenuItem key={item.key} item={item} pathname={pathname} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      {footer ? <div className="border-t border-sidebar-border p-2">{footer}</div> : null}
    </Sidebar>
  )
}

function NavMenuItem({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = resolveNavIcon(item.icon)
  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
  const children = item.children

  if (children?.length) {
    const groupActive = children.some((child) => pathname.startsWith(child.href))
    return (
      // `SidebarMenuItem` (an `<li>`) is the direct child of `SidebarMenu`
      // (a `<ul>`) — `Collapsible` (a plain `<div>`) wraps the trigger +
      // content *inside* the `<li>` instead of wrapping the `<li>` itself.
      // The other way around put a `<div>` directly inside the `<ul>`,
      // which is invalid list markup (axe: list / listitem).
      <SidebarMenuItem>
        <Collapsible defaultOpen={groupActive} className="group/collapsible">
          <CollapsibleTrigger asChild>
            <SidebarMenuButton isActive={groupActive} tooltip={item.label}>
              {/* eslint-disable-next-line react-hooks/static-components --
                  `Icon` is a stable reference resolved from the static
                  NAV_ICON_MAP lookup table (nav-icons.ts), not a component
                  freshly defined per render — the lint rule can't
                  distinguish "selected" from "created." */}
              {Icon ? <Icon /> : null}
              <span>{item.label}</span>
              <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {children.map((child) => (
                <SidebarMenuSubItem key={child.key}>
                  <SidebarMenuSubButton asChild isActive={pathname === child.href}>
                    <Link href={child.href}>{child.label}</Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenuItem>
    )
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
        <Link href={item.href}>
          {/* eslint-disable-next-line react-hooks/static-components --
              same stable-lookup reference as above. */}
          {Icon ? <Icon /> : null}
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
      {item.badge !== undefined ? <SidebarMenuBadge>{item.badge}</SidebarMenuBadge> : null}
    </SidebarMenuItem>
  )
}
