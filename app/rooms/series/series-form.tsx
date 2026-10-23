"use client"

import * as React from "react"
import { toast } from "sonner"

import { FormDialog } from "@/components/form-dialog"
import type { Member } from "@/components/member-combobox"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DURATION_PRESETS, slotStarts } from "@/lib/rooms/time"

import { createSeriesAction } from "../actions"
import {
  MeetingFields,
  emptyMeeting,
  meetingInput,
  type MeetingValue,
  type RoomGroup,
} from "../meeting-fields"

const weekdays = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"]

function Choice({
  id,
  label,
  value,
  onChange,
  items,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  items: { value: string; label: string }[]
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        onValueChange={(next) => onChange(String(next))}
        items={items}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function SeriesForm({
  groups,
  members,
}: {
  groups: RoomGroup[]
  members: (Member & { username: string | null })[]
}) {
  const [weekday, setWeekday] = React.useState("1")
  const [start, setStart] = React.useState("10:00")
  const [minutes, setMinutes] = React.useState("60")
  const [interval, setInterval] = React.useState("1")
  const [meeting, setMeeting] = React.useState<MeetingValue>(emptyMeeting)

  async function submit() {
    const { result, error } = await createSeriesAction({
      weekday: Number(weekday),
      start_time: start,
      duration_minutes: Number(minutes),
      interval_weeks: Number(interval),
      ...meetingInput(meeting),
    })
    if (error) {
      toast.error(error)
      throw new Error(error)
    }
    if (result!.errors.length)
      toast.warning(`已建立，但這週沒訂到：${result!.errors.join("；")}`)
    else
      toast.success(
        result!.booked ? `已建立，先訂好 ${result!.booked} 場` : "已建立"
      )
    setMeeting(emptyMeeting)
  }

  return (
    <FormDialog
      trigger={<Button>新增固定會議</Button>}
      title="新增固定會議"
      size="wide"
      submitLabel="新增"
      onSubmit={submit}
    >
      <Choice
        id="series-weekday"
        label="星期"
        value={weekday}
        onChange={setWeekday}
        items={weekdays.map((label, i) => ({ value: String(i), label }))}
      />
      <Choice
        id="series-interval"
        label="頻率"
        value={interval}
        onChange={setInterval}
        items={[
          { value: "1", label: "每週" },
          { value: "2", label: "隔週" },
        ]}
      />
      <Choice
        id="series-start"
        label="開始"
        value={start}
        onChange={setStart}
        items={slotStarts().map((time) => ({ value: time, label: time }))}
      />
      <Choice
        id="series-minutes"
        label="時長"
        value={minutes}
        onChange={setMinutes}
        items={DURATION_PRESETS.map((m) => ({
          value: String(m),
          label: `${m} 分鐘`,
        }))}
      />
      <MeetingFields
        value={meeting}
        onChange={setMeeting}
        groups={groups}
        members={members}
        syncOnly
      />
    </FormDialog>
  )
}
