"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronDownIcon } from "lucide-react"

import { fieldTriggerClassName } from "@/lib/field"
import { PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// Pieces for a searchable picker: wrap them in Popover and put a Command in
// the content. Single or multiple choice is up to the Command inside.
function ComboboxTrigger({
  className,
  children,
  placeholder,
  ...props
}: React.ComponentProps<typeof PopoverTrigger> & {
  placeholder?: React.ReactNode
}) {
  const empty =
    children === undefined ||
    children === null ||
    children === false ||
    children === ""
  return (
    <PopoverTrigger
      data-slot="combobox-trigger"
      data-placeholder={empty ? "" : undefined}
      className={cn(fieldTriggerClassName, className)}
      {...props}
    >
      <span className="flex-1 truncate text-left">
        {empty ? placeholder : children}
      </span>
      <ChevronDownIcon className="text-muted-foreground" />
    </PopoverTrigger>
  )
}

// As wide as the trigger, like a select menu.
function ComboboxContent({
  className,
  ...props
}: React.ComponentProps<typeof PopoverContent>) {
  return (
    <PopoverContent
      data-slot="combobox-content"
      className={cn("w-(--anchor-width)", className)}
      {...props}
    />
  )
}

export { ComboboxContent, ComboboxTrigger }
