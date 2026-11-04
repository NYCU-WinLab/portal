"use client"

import * as React from "react"

import { EmptyState } from "@/components/empty-state"
import { ExpandRow } from "@/components/expand-row"
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

  if (!days.length) return <EmptyState noun="可預約的時段" />

  return (
    <>
      <ul className="flex stagger-rise flex-col">
        {days.map((day, i) => (
          <ExpandRow
            key={day.date}
            defaultOpen={i === 0}
            summary={
              <span className="flex items-center gap-4">
                <span className="font-medium">{dayLabel(day.date)}</span>
                <span className="text-muted-foreground">
                  {day.starts.length} 個空檔
                </span>
              </span>
            }
          >
            <div className="flex flex-wrap gap-2">
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
            </div>
          </ExpandRow>
        ))}
      </ul>
      <FormDialog
        open={picked !== null}
        onOpenChange={(open) => !open && setPicked(null)}
        title={`預約 ${name}`}
        submitLabel="預約"
        onSubmit={submit}
      >
        <FormField label="時間">
          <Input
            readOnly
            value={
              picked
                ? `${dayLabel(picked.date)} ${picked.start}，${slotMinutes} 分鐘`
                : ""
            }
          />
        </FormField>
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
