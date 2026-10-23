"use client"

import { RotateCcwIcon } from "lucide-react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { report } from "@/lib/report"

import { PlayButton } from "../sounds/play-button"
import { rerecord } from "./actions"

type Clip = { id: string; text: string }

// Every text the door speaks in CC's voice, A to Z, then the ones still
// waiting for the voice job. Re-recording deletes a clip; the job makes it
// again on its next run.
export function ClipList({
  clips,
  missing,
}: {
  clips: Clip[]
  missing: string[]
}) {
  if (clips.length === 0 && missing.length === 0)
    return <EmptyState noun="語音" />
  return (
    <ul className="flex stagger-rise flex-col">
      {clips.map((clip) => (
        <li
          key={clip.id}
          className="flex min-h-14 items-center gap-4 border-b border-border py-2"
        >
          <PlayButton
            src={`/door/voice/files/${clip.id}`}
            label={clip.text}
          />
          <span className="min-w-0 flex-1 truncate">{clip.text}</span>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="icon" aria-label="重錄">
                <RotateCcwIcon />
              </Button>
            }
            title={`重錄「${clip.text}」？`}
            confirmLabel="重錄"
            onConfirm={() => report(rerecord(clip.id), "已排入重錄")}
          />
        </li>
      ))}
      {missing.map((text) => (
        <li
          key={text}
          className="flex min-h-14 items-center gap-4 border-b border-border py-2"
        >
          <span className="size-9 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {text}
          </span>
          <Badge variant="muted">錄製中</Badge>
        </li>
      ))}
    </ul>
  )
}
