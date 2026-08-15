"use client"

import * as React from "react"
import { Bold, Italic, List, ListOrdered } from "lucide-react"
import { cn } from "@/lib/utils"
import { Toggle } from "@/components/ui/toggle"

export interface RichTextFoundationProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  className?: string
  /** Accessible name for the editable region — required, since a `role="textbox"` `<div>` has no implicit one (unlike a real `<textarea>` with a `<label for>`). */
  "aria-label": string
}

/**
 * A genuine FOUNDATION, not a full rich-text editor — a styled,
 * accessible contentEditable region with basic bold/italic/list
 * formatting (via the still-universally-supported subset of
 * `document.execCommand`), matching the design system's spacing/
 * typography/focus-state conventions. When a module needs real rich-text
 * editing (structured output, collaborative editing, custom marks/nodes),
 * replace this with a proper editor (Tiptap is the natural choice given
 * the rest of the stack) — this component's job is to look and feel
 * right today without pulling in an editor framework before anything
 * actually needs one. Do not extend this file with more execCommand
 * calls; swap the whole component instead.
 */
export function RichTextFoundation({ value, onChange, placeholder, className, "aria-label": ariaLabel }: RichTextFoundationProps) {
  const editorRef = React.useRef<HTMLDivElement>(null)

  function exec(command: string) {
    editorRef.current?.focus()
    document.execCommand(command)
    onChange(editorRef.current?.innerHTML ?? "")
  }

  return (
    <div className={cn("rounded-lg border border-input", className)}>
      <div className="flex items-center gap-1 border-b border-border p-1.5">
        <Toggle size="sm" aria-label="Bold" onPressedChange={() => exec("bold")}>
          <Bold className="size-3.5" />
        </Toggle>
        <Toggle size="sm" aria-label="Italic" onPressedChange={() => exec("italic")}>
          <Italic className="size-3.5" />
        </Toggle>
        <Toggle size="sm" aria-label="Bulleted list" onPressedChange={() => exec("insertUnorderedList")}>
          <List className="size-3.5" />
        </Toggle>
        <Toggle size="sm" aria-label="Numbered list" onPressedChange={() => exec("insertOrderedList")}>
          <ListOrdered className="size-3.5" />
        </Toggle>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        aria-placeholder={placeholder}
        data-placeholder={placeholder}
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
        dangerouslySetInnerHTML={{ __html: value }}
        className={cn(
          "min-h-32 px-3 py-2 text-sm outline-none",
          "empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
        )}
      />
    </div>
  )
}
