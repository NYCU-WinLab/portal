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

// Notes closed in this tab. Pages the router fetched before the close (a
// prefetched link, the page behind Back) still carry the dialog with the
// same notes; it must not open again from them. A reload starts empty, and
// by then the server no longer sends these notes.
const closed = new Set<string>()

// A visit after a deploy with new notes shows what changed since the member last closed
// this; closing it, any way, marks those notes seen.
export function ReleaseDialog({ notes }: { notes: ReleaseNote[] }) {
  const [open, setOpen] = React.useState(() =>
    notes.some((note) => !closed.has(note.slug))
  )

  function close() {
    for (const note of notes) closed.add(note.slug)
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
