"use client"

import { PencilIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

import { updateMeetingAction } from "./rooms-actions"

// Edits what a meeting can change without new invites: the external link
// and the agenda.
export function EditMeeting({
  target,
  title,
  externalUrl,
  agenda,
}: {
  target: { booking: string } | { series: string }
  title: string
  externalUrl: string | null
  agenda: string | null
}) {
  // What the form showed when it opened: a live refresh may change the
  // props while it is open, and only the member's own edits are sent.
  const opened = React.useRef({ externalUrl, agenda })

  async function save(data: FormData) {
    // Only what changed: a series edit writes each field to every booked
    // week, and a link set on one week by hand should survive an agenda edit.
    const link = String(data.get("external_url") ?? "").trim() || null
    const text = String(data.get("agenda") ?? "").trim() || null
    const changes = {
      ...(link !== opened.current.externalUrl ? { external_url: link } : {}),
      ...(text !== (opened.current.agenda?.trim() || null)
        ? { agenda: text }
        : {}),
    }
    if (!Object.keys(changes).length) return
    const { error } = await updateMeetingAction({ ...target, ...changes })
    if (error) {
      toast.error(error)
      throw new Error(error)
    }
    toast.success("已儲存")
  }

  return (
    <FormDialog
      trigger={
        <Button
          variant="ghost"
          size="icon"
          aria-label="編輯"
          onClick={() => {
            opened.current = { externalUrl, agenda }
          }}
        >
          <PencilIcon />
        </Button>
      }
      title={title}
      submitLabel="儲存"
      onSubmit={save}
    >
      <FormField label="外部會議連結">
        <Input
          name="external_url"
          type="url"
          inputMode="url"
          placeholder="https://"
          maxLength={2000}
          defaultValue={externalUrl ?? ""}
        />
      </FormField>
      <FormField label="討論事項">
        <Textarea
          name="agenda"
          maxLength={2000}
          rows={4}
          defaultValue={agenda ?? ""}
        />
      </FormField>
    </FormDialog>
  )
}
