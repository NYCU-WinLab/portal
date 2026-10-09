"use client"

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"
import { ChevronDownIcon } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

// A list row that opens in place to show more, instead of going to another
// page or a dialog. The summary is the row as the list shows it; the details
// unfold under it on the spring. Row actions sit beside the summary, outside
// the toggle, so pressing one never opens the row.
function ExpandRow({
  summary,
  actions,
  children,
  defaultOpen,
  className,
}: {
  summary: React.ReactNode
  actions?: React.ReactNode
  /** The details. */
  children: React.ReactNode
  defaultOpen?: boolean
  className?: string
}) {
  return (
    <CollapsiblePrimitive.Root
      data-slot="expand-row"
      defaultOpen={defaultOpen}
      render={<li />}
      className={cn("border-b border-border", className)}
    >
      <div className="flex min-h-14 items-center gap-4">
        <CollapsiblePrimitive.Trigger className="group/row flex min-w-0 flex-1 items-center gap-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <div className="min-w-0 flex-1">{summary}</div>
          <ChevronDownIcon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-spring group-data-panel-open/row:rotate-180"
          />
        </CollapsiblePrimitive.Trigger>
        {actions && <div className="flex shrink-0 gap-1">{actions}</div>}
      </div>
      <CollapsiblePrimitive.Panel className="h-(--collapsible-panel-height) overflow-hidden transition-all duration-spring data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        <div className="pb-4">{children}</div>
      </CollapsiblePrimitive.Panel>
    </CollapsiblePrimitive.Root>
  )
}

export { ExpandRow }
