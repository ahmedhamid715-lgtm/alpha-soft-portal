"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export interface DatePickerProps {
  value?: Date
  onChange: (date: Date | undefined) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /** e.g. disable past dates for a due-date field. */
  disabledDates?: (date: Date) => boolean
}

const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })

export function DatePicker({ value, onChange, placeholder = "Pick a date", disabled, className, disabledDates }: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn("w-full justify-start font-normal", !value && "text-muted-foreground", className)}
        >
          <CalendarIcon className="size-4" aria-hidden="true" />
          {value ? formatter.format(value) : placeholder}
        </Button>
      </PopoverTrigger>
      {/* Radix's Popover.Content renders `role="dialog"` internally and needs an accessible name (axe: aria-dialog-name) — a plain `<div>` wrapper wouldn't get this requirement, but a dialog role does. */}
      <PopoverContent className="w-auto p-0" align="start" aria-label={placeholder}>
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            onChange(date)
            setOpen(false)
          }}
          disabled={disabledDates}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
