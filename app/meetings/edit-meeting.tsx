"use client"

import { PencilIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  SLOT_MINUTES,
  clock,
} from "@/lib/rooms/time"

import { moveMeetingAction, updateMeetingAction } from "./rooms-actions"

/** A one-off booking's time, when the member may move it. */
type When = { date: string; start: string; end: string; room: boolean }

// A room booking stays within the department's hours; an online one may
// run any half hour of the day, until midnight.
const gridOf = (room: boolean) => {
  const from = room ? DAY_START_HOUR * 60 : 0
  const to = room ? DAY_END_HOUR * 60 : 24 * 60
  const times = Array.from(
    { length: (to - from) / SLOT_MINUTES + 1 },
    (_, i) =>
      from + i * SLOT_MINUTES === 24 * 60
        ? "24:00"
        : clock(from + i * SLOT_MINUTES)
  )
  return { starts: times.slice(0, -1), ends: times.slice(1) }
}

const minutesOf = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3))

// Edits a meeting's external link and agenda; for a one-off booking of the
// member's own, also its date and time (everyone gets the new invite).
export function EditMeeting({
  target,
  title,
  externalUrl,
  agenda,
  when,
  today,
}: {
  target: { booking: string } | { series: string }
  title: string
  externalUrl: string | null
  agenda: string | null
  when?: When
  today?: string
}) {
  // What the form showed when it opened: a live refresh may change the
  // props while it is open, and only the member's own edits are sent.
  const opened = React.useRef({ externalUrl, agenda, when })
  const [start, setStart] = React.useState(when?.start ?? "")
  const [end, setEnd] = React.useState(when?.end ?? "")
  const grid = when ? gridOf(when.room) : null

  async function save(data: FormData) {
    const was = opened.current.when
    if (was && "booking" in target) {
      const date = String(data.get("date") ?? "")
      if (date !== was.date || start !== was.start || end !== was.end) {
        const { result, error } = await moveMeetingAction({
          id: target.booking,
          date,
          start_time: start,
          end_time: end,
        })
        if (error) {
          toast.error(error)
          throw new Error(error)
        }
        if (result!.room_error) toast.warning(result!.room_error)
        if (result!.meet_error)
          toast.warning(`線上會議室沒跟著改：${result!.meet_error}`)
        toast.success(
          result!.room
            ? `已改到 ${result!.room}，新邀請寄出中`
            : "已改時間，新邀請寄出中"
        )
      }
    }
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
            opened.current = { externalUrl, agenda, when }
            setStart(when?.start ?? "")
            setEnd(when?.end ?? "")
          }}
        >
          <PencilIcon />
        </Button>
      }
      title={title}
      submitLabel="儲存"
      onSubmit={save}
    >
      {when && grid && (
        <>
          <FormField label="日期">
            <Input
              name="date"
              type="date"
              min={today}
              required
              defaultValue={when.date}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <TimeField
              label="開始"
              value={start}
              times={grid.starts}
              onChange={(next) => {
                // Keeps the length, cut short at the end of the grid.
                const length = minutesOf(end) - minutesOf(start)
                const last = grid.ends.at(-1)!
                const to = minutesOf(next) + length
                setStart(next)
                setEnd(to >= minutesOf(last) ? last : clock(to))
              }}
            />
            <TimeField
              label="結束"
              value={end}
              times={grid.ends.filter((t) => t > start)}
              onChange={setEnd}
            />
          </div>
        </>
      )}
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

function TimeField({
  label,
  value,
  times,
  onChange,
}: {
  label: string
  value: string
  times: string[]
  onChange: (value: string) => void
}) {
  return (
    <FormField label={label}>
      <Select
        value={value}
        onValueChange={(next) => onChange(String(next))}
        items={times.map((t) => ({ value: t, label: t }))}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {times.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  )
}
