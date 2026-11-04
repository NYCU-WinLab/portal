"use client"

import * as React from "react"

import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { report } from "@/lib/report"
import { dayLabel } from "@/lib/rooms/time"

import { bookAppointmentAction } from "../actions"

export function BookSlots({
  userId,
  name,
  slotMinutes,
  days,
}: {
  userId: string
  name: string
  slotMinutes: number
  days: { date: string; starts: string[] }[]
}) {
  const [picked, setPicked] = React.useState<{
    date: string
    start: string
  } | null>(null)
  const [room, setRoom] = React.useState(false)

  async function submit(data: FormData) {
    await report(
      bookAppointmentAction({
        user_id: userId,
        date: picked!.date,
        start_time: picked!.start,
        title: String(data.get("title") ?? ""),
        agenda: String(data.get("agenda") ?? "") || null,
        online_only: !room,
      }),
      "已預約，邀請已寄出"
    )
    setPicked(null)
  }

  if (!days.length)
    return <p className="text-muted-foreground">目前沒有可預約的時段</p>

  return (
    <>
      <ul className="flex flex-col">
        {days.map((day) => (
          <li
            key={day.date}
            className="flex min-h-14 flex-wrap items-center gap-2 border-b border-border py-2"
          >
            <span className="w-28 shrink-0 text-muted-foreground">
              {dayLabel(day.date)}
            </span>
            {day.starts.map((start) => (
              <Button
                key={start}
                variant="outline"
                className="tabular-nums"
                onClick={() => setPicked({ date: day.date, start })}
              >
                {start}
              </Button>
            ))}
          </li>
        ))}
      </ul>
      <FormDialog
        open={picked !== null}
        onOpenChange={(open) => !open && setPicked(null)}
        title={
          picked
            ? `預約 ${name}：${dayLabel(picked.date)} ${picked.start}，${slotMinutes} 分鐘`
            : ""
        }
        submitLabel="預約"
        onSubmit={submit}
      >
        <FormField label="標題" required>
          <Input name="title" maxLength={80} required />
        </FormField>
        <FormField label="議程">
          <Textarea name="agenda" maxLength={2000} rows={3} />
        </FormField>
        <label className="flex items-center gap-3">
          <Switch checked={room} onCheckedChange={setRoom} />
          借系上教室
        </label>
      </FormDialog>
    </>
  )
}
