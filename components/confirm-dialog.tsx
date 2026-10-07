"use client"

import * as React from "react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

type ConfirmDialogProps = {
  /** The button that opens it. Leave out and pass open / onOpenChange to
   * open it from elsewhere, such as a dropdown-menu item. */
  trigger?: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title: string
  /** The verb on the confirm button: "刪除", "撤回". Never "確定". */
  confirmLabel: string
  /** Shown while onConfirm runs; defaults to the verb + "中…". */
  pendingLabel?: string
  /** destructive for what cannot be undone, default for the rest. */
  variant?: "destructive" | "default"
  /** Runs while both buttons are locked. Resolve to close; throw to stay
   * open so the member can retry (report the error yourself, in a toast). */
  onConfirm: () => void | Promise<void>
}

// Asks before an action runs, and holds the dialog open until it finishes
// so a second click can never fire it twice.
function ConfirmDialog({
  trigger,
  open: openProp,
  onOpenChange,
  title,
  confirmLabel,
  pendingLabel = `${confirmLabel}中…`,
  variant = "destructive",
  onConfirm,
}: ConfirmDialogProps) {
  const [openState, setOpenState] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const open = openProp ?? openState

  function setOpen(next: boolean) {
    if (openProp === undefined) setOpenState(next)
    onOpenChange?.(next)
  }

  function confirm() {
    startTransition(async () => {
      try {
        await onConfirm()
        setOpen(false)
      } catch (error) {
        console.error(error)
      }
    })
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next)
      }}
    >
      {trigger && <AlertDialogTrigger render={trigger} />}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <Button variant={variant} disabled={pending} onClick={confirm}>
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { ConfirmDialog }
