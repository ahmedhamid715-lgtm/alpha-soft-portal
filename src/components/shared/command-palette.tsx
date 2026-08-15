"use client"

import * as React from "react"
import type { LucideIcon } from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"

export interface CommandPaletteItem {
  id: string
  label: string
  icon?: LucideIcon
  shortcut?: string
  onSelect: () => void
}

export interface CommandPaletteGroup {
  heading: string
  items: CommandPaletteItem[]
}

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: CommandPaletteGroup[]
  emptyText?: string
}

/**
 * Global search/action surface (⌘K) — content-free by design, like
 * DataTable. A module supplies `groups` (jump-to-page items, quick
 * actions, recent records); this component only owns the dialog,
 * filtering, and keyboard navigation, all inherited from the underlying
 * cmdk-based Command primitive. Pair with `useCommandPaletteShortcut` to
 * wire the ⌘K/Ctrl+K keybinding.
 */
export function CommandPalette({ open, onOpenChange, groups, emptyText = "No results found." }: CommandPaletteProps) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette" description="Search pages and actions">
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>{emptyText}</CommandEmpty>
        {groups.map((group, index) => (
          <React.Fragment key={group.heading}>
            {index > 0 ? <CommandSeparator /> : null}
            <CommandGroup heading={group.heading}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.label}
                  onSelect={() => {
                    onOpenChange(false)
                    item.onSelect()
                  }}
                >
                  {item.icon ? <item.icon className="size-4" aria-hidden="true" /> : null}
                  <span>{item.label}</span>
                  {item.shortcut ? <CommandShortcut>{item.shortcut}</CommandShortcut> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </React.Fragment>
        ))}
      </CommandList>
    </CommandDialog>
  )
}

/** Wires ⌘K (macOS) / Ctrl+K (other) to toggle the palette. Call once, near the top of the tree that owns `open` state. */
export function useCommandPaletteShortcut(setOpen: (open: boolean | ((prev: boolean) => boolean)) => void) {
  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [setOpen])
}
