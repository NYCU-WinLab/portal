import * as React from "react"

import { cn } from "@/lib/utils"

// The one loud thing on a page: what the member came to see first (the next
// meeting, today's order, what waits on them). It rises in on the spring and
// is the only place a page uses the primary color for text. Everything
// below it stays quiet. One per page, right under the page header.
function Focus({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="focus"
      className={cn(
        "flex animate-rise flex-col gap-3 border-b border-border pb-6",
        className
      )}
      {...props}
    />
  )
}

// What the focus is about, in a word or two: "下一場", "今天".
function FocusLabel({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="focus-label"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

// The loud line itself. Wrap the part that matters most in FocusHighlight.
function FocusTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="focus-title"
      className={cn("text-title font-medium text-balance", className)}
      {...props}
    />
  )
}

function FocusHighlight({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="focus-highlight"
      className={cn("text-primary tabular-nums", className)}
      {...props}
    />
  )
}

// A row of facts under the title: who, where, when, an avatar stack.
function FocusMeta({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="focus-meta"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Focus, FocusHighlight, FocusLabel, FocusMeta, FocusTitle }
