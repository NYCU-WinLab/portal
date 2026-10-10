import * as React from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

type AttachmentState = "idle" | "uploading" | "error" | "done"

// One file: a 40px icon or thumbnail, its name and a detail line, then
// actions. It keeps its own outline like an input, since it is a control;
// rounded-menu with p-1 around the control-radius media (concentric).
// idle is dashed (not sent yet), uploading pulses, error turns destructive.
function Attachment({
  className,
  state = "done",
  ...props
}: React.ComponentProps<"div"> & { state?: AttachmentState }) {
  return (
    <div
      data-slot="attachment"
      data-state={state}
      className={cn(
        "group/attachment relative flex w-full min-w-0 items-center gap-3 rounded-menu border border-border p-1 pr-2 text-body transition-colors duration-state has-[>[data-slot=attachment-trigger]]:hover:bg-muted/50 data-[state=error]:border-destructive/30 data-[state=idle]:border-dashed",
        className
      )}
      {...props}
    />
  )
}

function AttachmentMedia({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-media"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-control bg-muted group-data-[state=error]/attachment:bg-destructive/10 group-data-[state=error]/attachment:text-destructive group-data-[state=uploading]/attachment:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 *:[img]:size-full *:[img]:object-cover",
        className
      )}
      {...props}
    />
  )
}

function AttachmentContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-content"
      className={cn("flex min-w-0 flex-1 flex-col", className)}
      {...props}
    />
  )
}

function AttachmentTitle({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="attachment-title"
      className={cn(
        "truncate font-medium group-data-[state=uploading]/attachment:animate-pulse",
        className
      )}
      {...props}
    />
  )
}

function AttachmentDescription({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="attachment-description"
      className={cn(
        "truncate text-muted-foreground tabular-nums group-data-[state=error]/attachment:text-destructive",
        className
      )}
      {...props}
    />
  )
}

// Sits above the trigger, so its buttons stay clickable.
function AttachmentActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-actions"
      className={cn("relative z-20 flex shrink-0 items-center", className)}
      {...props}
    />
  )
}

// A ghost icon button; give it an aria-label naming the verb.
function AttachmentAction({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="attachment-action"
      variant="ghost"
      size="icon"
      className={cn(className)}
      {...props}
    />
  )
}

// Makes the whole attachment clickable (open, preview); render a link with
// render={<a href=… />}.
function AttachmentTrigger({
  className,
  render,
  type,
  ...props
}: useRender.ComponentProps<"button">) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        type: render ? type : (type ?? "button"),
        className: cn(
          "absolute inset-0 z-10 rounded-menu outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          className
        ),
      },
      props
    ),
    render,
    state: { slot: "attachment-trigger" },
  })
}

// A list of attachments, one per row.
function AttachmentGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-group"
      className={cn("flex min-w-0 flex-col gap-2", className)}
      {...props}
    />
  )
}

export {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
}
