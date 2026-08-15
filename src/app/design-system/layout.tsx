"use client"

import { useState } from "react"
import {
  Bot,
  Building2,
  CreditCard,
  FileText,
  Handshake,
  LayoutDashboard,
  LifeBuoy,
  Plus,
  Settings,
  Ticket,
  Users,
} from "lucide-react"
import { AppShell } from "@/components/layout/app-shell"
import type { NavGroup } from "@/components/layout/app-sidebar"
import { CommandPalette, useCommandPaletteShortcut } from "@/components/shared/command-palette"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Sample navigation for the showcase only — a deliberate mix of module
 * names (CRM, Projects, SEO-ish "Marketing", Support, Billing) so the
 * shell demonstrates nested items, badges, and icon variety. None of
 * this is real navigation config; it does not belong in
 * config/navigation.ts (see that file's own comment).
 */
const demoNavGroups: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { key: "dashboard", label: "Dashboard", href: "/design-system", icon: "dashboard" },
      {
        key: "crm",
        label: "CRM",
        href: "/design-system#data",
        icon: "crm",
        children: [
          { key: "leads", label: "Leads", href: "/design-system#data" },
          { key: "deals", label: "Deals", href: "/design-system#data" },
        ],
      },
      { key: "projects", label: "Projects", href: "/design-system#data", icon: "projects", badge: 12 },
      { key: "support", label: "Support", href: "/design-system#feedback", icon: "support", badge: "3" },
    ],
  },
  {
    label: "Insights",
    items: [
      { key: "analytics", label: "Analytics", href: "/design-system#charts", icon: "analytics" },
      { key: "ai", label: "AI Assistant", href: "/design-system#ai", icon: "ai" },
    ],
  },
  {
    label: "Organization",
    items: [
      { key: "billing", label: "Billing", href: "/design-system#foundations", icon: "billing" },
      { key: "settings", label: "Settings", href: "/design-system#foundations", icon: "settings" },
    ],
  },
]

const commandGroups = [
  {
    heading: "Navigate",
    items: [
      { id: "nav-dashboard", label: "Go to Dashboard", icon: LayoutDashboard, onSelect: () => {} },
      { id: "nav-crm", label: "Go to CRM", icon: Handshake, onSelect: () => {} },
      { id: "nav-support", label: "Go to Support", icon: LifeBuoy, onSelect: () => {}, shortcut: "G S" },
      { id: "nav-billing", label: "Go to Billing", icon: CreditCard, onSelect: () => {} },
    ],
  },
  {
    heading: "Actions",
    items: [
      { id: "action-new-ticket", label: "Create support ticket", icon: Plus, onSelect: () => {} },
      { id: "action-new-project", label: "Create project", icon: Plus, onSelect: () => {} },
      { id: "action-invite", label: "Invite team member", icon: Users, onSelect: () => {} },
    ],
  },
  {
    heading: "Recent",
    items: [
      { id: "recent-acme", label: "Acme Co — Website Redesign", icon: Building2, onSelect: () => {} },
      { id: "recent-invoice", label: "Invoice #1042", icon: FileText, onSelect: () => {} },
      { id: "recent-ticket", label: "Ticket #318 — Billing question", icon: Ticket, onSelect: () => {} },
    ],
  },
]

export default function DesignSystemLayout({ children }: { children: React.ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false)
  useCommandPaletteShortcut(setCommandOpen)

  return (
    <AppShell
      roleLabel="Design System"
      navGroups={demoNavGroups}
      onSearchClick={() => setCommandOpen(true)}
      topNavEnd={
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <Avatar className="size-8 border border-border">
              <AvatarFallback className="text-xs">AP</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Alex Parker</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Settings /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Bot /> AI preferences
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {children}
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} groups={commandGroups} />
    </AppShell>
  )
}
