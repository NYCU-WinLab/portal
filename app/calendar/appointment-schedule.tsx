"use client"

import * as React from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { report } from "@/lib/report"
import { dayLabel } from "@/lib/rooms/time"

import { cancelAppointmentAction, saveScheduleAction } from "./actions"

type Window = { weekday: number; start: string; end: string }

// Monday first, as the lab's week runs.
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]
const NAMES = "日一二三四五六"
const TIMES = Array.from({ length: 29 }, (_, i) => {
  const minutes = 8 * 60 + i * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
})

function Pick({
  value,
  items,
  label,
  onChange,
  disabled,
}: {
  value: string
  items: { value: string; label: string }[]
  label: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(String(next))}
      items={items}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className="w-28">
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
  )
}

const times = TIMES.map((t) => ({ value: t, label: t }))

export function AppointmentSchedule({
  schedule,
  appointments,
}: {
  schedule: {
    windows: Window[]
    slotMinutes: number
    aheadDays: number
  } | null
  appointments: {
    id: string
    date: string
    start: string
    end: string
    title: string
    bookedBy: string
  }[]
}) {
  const [days, setDays] = React.useState(() =>
    WEEKDAYS.map((weekday) => {
      const found = schedule?.windows.find((w) => w.weekday === weekday)
      return {
        weekday,
        on: !!found,
        start: found?.start ?? "14:00",
        end: found?.end ?? "17:00",
      }
    })
  )
  const [slot, setSlot] = React.useState(String(schedule?.slotMinutes ?? 30))
  const [ahead, setAhead] = React.useState(String(schedule?.aheadDays ?? 14))
  const [pending, startTransition] = React.useTransition()

  const update = (weekday: number, change: Partial<(typeof days)[number]>) =>
    setDays((current) =>
      current.map((day) =>
        day.weekday === weekday ? { ...day, ...change } : day
      )
    )

  function save() {
    startTransition(async () => {
      const windows = days
        .filter((day) => day.on)
        .map(({ weekday, start, end }) => ({ weekday, start, end }))
      await report(
        saveScheduleAction({
          windows,
          slot_minutes: Number(slot) as 30 | 60,
          ahead_days: Number(ahead),
        }),
        windows.length ? "已開放預約" : "已停止預約"
      ).catch(() => {})
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col">
        {days.map((day) => (
          <li
            key={day.weekday}
            className="flex min-h-14 items-center gap-4 border-b border-border py-2"
          >
            <label className="flex w-24 shrink-0 items-center gap-3">
              <Switch
                checked={day.on}
                aria-label={`星期${NAMES[day.weekday]}開放預約`}
                onCheckedChange={(on) => update(day.weekday, { on })}
              />
              <span className="font-medium">週{NAMES[day.weekday]}</span>
            </label>
            <Pick
              label={`星期${NAMES[day.weekday]}開始`}
              value={day.start}
              items={times.slice(0, -1)}
              disabled={!day.on}
              onChange={(start) => update(day.weekday, { start })}
            />
            <span className="text-muted-foreground">到</span>
            <Pick
              label={`星期${NAMES[day.weekday]}結束`}
              value={day.end}
              items={times.slice(1)}
              disabled={!day.on}
              onChange={(end) => update(day.weekday, { end })}
            />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-muted-foreground">每段</span>
        <Pick
          label="每段長度"
          value={slot}
          items={[
            { value: "30", label: "30 分鐘" },
            { value: "60", label: "60 分鐘" },
          ]}
          onChange={setSlot}
        />
        <span className="text-muted-foreground">最多預約</span>
        <Pick
          label="最多預約幾天後"
          value={ahead}
          items={[7, 14, 30, 60].map((n) => ({
            value: String(n),
            label: `${n} 天後`,
          }))}
          onChange={setAhead}
        />
        <Button className="ml-auto" disabled={pending} onClick={save}>
          {pending ? "儲存中…" : "儲存"}
        </Button>
      </div>
      {appointments.length > 0 && (
        <ul className="flex flex-col">
          {appointments.map((row) => (
            <li
              key={row.id}
              className="flex min-h-14 items-center gap-4 border-b border-border py-2"
            >
              <span className="w-48 shrink-0 text-muted-foreground tabular-nums">
                {dayLabel(row.date)} {row.start} 到 {row.end}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {row.title}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {row.bookedBy}
              </span>
              <ConfirmDialog
                trigger={<Button variant="outline">取消</Button>}
                title={`取消 ${row.bookedBy} 的預約？`}
                confirmLabel="取消預約"
                variant="destructive"
                onConfirm={() =>
                  report(cancelAppointmentAction(row.id), "已取消，已寄信通知")
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
