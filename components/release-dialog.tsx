"use client"

import * as React from "react"

import { ReleaseNotes, type ReleaseNote } from "@/components/release-notes"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { markSeen } from "@/app/changelog/actions"

// The day's first visit shows what changed since the member last closed
// this; closing it, any way, marks those notes seen.
export function ReleaseDialog({ notes }: { notes: ReleaseNote[] }) {
  const [open, setOpen] = React.useState(true)

  function close() {
    setOpen(false)
    void markSeen()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent size="wide" className="max-h-160 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Portal 更新了</DialogTitle>
        </DialogHeader>
        <ReleaseNotes notes={notes} />
        <DialogFooter>
          <Button onClick={close}>知道了</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
