"use client"

import * as React from "react"
import { UploadCloud } from "lucide-react"
import { cn } from "@/lib/utils"

export interface FileUploadProps {
  onFilesSelected: (files: File[]) => void
  accept?: string
  multiple?: boolean
  /** Human-readable hint text, e.g. "PDF, PNG up to 10MB". */
  hint?: string
  disabled?: boolean
  className?: string
}

/**
 * Drag-and-drop zone + click-to-browse, both wired to the same
 * `onFilesSelected` callback. This is the UI only — actually uploading a
 * File to storage is Module 56's job (StorageProvider,
 * lib/platform/storage.ts); this component's contract ends at "here are
 * the File objects the user picked."
 */
export function FileUpload({ onFilesSelected, accept, multiple = true, hint, disabled, className }: FileUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = React.useState(false)

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    onFilesSelected(Array.from(fileList))
  }

  return (
    // Outer element is a plain, non-interactive `div` — the hidden file
    // `<input>` is a sibling of the `role="button"` dropzone below, not a
    // child of it. An `<input>` is inherently focusable/interactive
    // regardless of `tabIndex={-1}`/`aria-hidden`, so nesting it inside
    // another interactive control is a real nested-interactive violation
    // (assistive tech and axe both flag it); clicking it via `inputRef`
    // works identically from a sibling position.
    <div className="relative">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (!disabled && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragActive(false)
          if (!disabled) handleFiles(event.dataTransfer.files)
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center transition-colors",
          "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          dragActive && "border-primary bg-primary/5",
          disabled && "pointer-events-none opacity-50",
          className
        )}
      >
        <UploadCloud className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm">
          <span className="font-medium text-link">Click to upload</span>{" "}
          <span className="text-muted-foreground">or drag and drop</span>
        </p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => handleFiles(event.target.files)}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  )
}
