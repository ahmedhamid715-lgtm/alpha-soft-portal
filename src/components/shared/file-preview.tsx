import { File, FileImage, FileSpreadsheet, FileText, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export interface FilePreviewItem {
  id: string
  name: string
  /** Bytes. */
  size: number
  type?: string
  /** Upload progress 0–100; omit once complete or if not tracked. */
  progress?: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function iconFor(type?: string) {
  if (!type) return File
  if (type.startsWith("image/")) return FileImage
  if (type.includes("sheet") || type.includes("csv") || type.includes("excel")) return FileSpreadsheet
  if (type.includes("text") || type.includes("pdf") || type.includes("document")) return FileText
  return File
}

/** One row per selected/uploaded file — pairs with FileUpload for the "here's what you picked" list. */
export function FilePreview({
  file,
  onRemove,
  className,
}: {
  file: FilePreviewItem
  onRemove?: (id: string) => void
  className?: string
}) {
  const Icon = iconFor(file.type)
  const uploading = file.progress !== undefined && file.progress < 100

  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5", className)}>
      {/* eslint-disable-next-line react-hooks/static-components --
          `Icon` is resolved via a plain switch in `iconFor`, always
          returning one of a fixed set of module-level Lucide components —
          a stable reference, not a component created per render. */}
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        {uploading ? (
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${file.progress}%` }}
              role="progressbar"
              aria-valuenow={file.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Uploading ${file.name}`}
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
        )}
      </div>
      {onRemove ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onRemove(file.id)}
          aria-label={`Remove ${file.name}`}
        >
          <X />
        </Button>
      ) : null}
    </div>
  )
}
