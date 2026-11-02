"use client"

import { PencilIcon } from "lucide-react"
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
  async function save(data: FormData) {
    const { error } = await updateMeetingAction({
      ...target,
      external_url: String(data.get("external_url") ?? "") || null,
      agenda: String(data.get("agenda") ?? "") || null,
    })
    if (error) {
      toast.error(error)
      throw new Error(error)
    }
    toast.success("已儲存")
  }

  return (
    <FormDialog
      trigger={
        <Button variant="ghost" size="icon" aria-label="編輯">
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
