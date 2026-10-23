"use client"

import * as React from "react"
import { toast } from "sonner"

import { FormDialog } from "@/components/form-dialog"
import type { Member } from "@/components/member-combobox"
import { RoomStrip, RoomStripLegend } from "@/components/room-strip"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { pickRoom, type Slot } from "@/lib/rooms/availability"
import {
  DURATION_PRESETS,
  SLOT_MINUTES,
  addMinutes,
  dayLabel,
  weekdayOf,
} from "@/lib/rooms/time"

import {
  MeetingFields,
  emptyMeeting,
  meetingInput,
  type MeetingValue,
  type RoomGroup,
} from "./meeting-fields"
import {
  bookRoomAction,
  createSeriesAction,
  loadAvailability,
} from "./rooms-actions"

const DAYS = 14

type Day = { date: string; slots: Slot[] }
type People = (Member & { username: string | null })[]

// 新增會議: two weeks of department rooms, read live when it opens. Press a
// cell to fill in the meeting from there, once or every week.
export function NewMeeting({
  today,
  groups,
  members,
}: {
  today: string
  groups: RoomGroup[]
  members: People
}) {
  const [open, setOpen] = React.useState(false)
  const [days, setDays] = React.useState<Day[] | string | null>(null)
  const [picked, setPicked] = React.useState<{
    day: Day
    index: number
  } | null>(null)

  const load = React.useCallback(() => {
    setDays(null)
    void loadAvailability(today, DAYS).then(({ result, error }) =>
      setDays(
        error ??
          result!.days.map((day) => ({
            date: day.date,
            slots: "slots" in day ? day.slots : [],
          }))
      )
    )
  }, [today])

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true)
          load()
        }}
      >
        新增會議
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="wide">
          <DialogHeader>
            <DialogTitle>選時段</DialogTitle>
          </DialogHeader>
          {days === null ? (
            <p className="text-muted-foreground">正在讀系上借用系統…</p>
          ) : typeof days === "string" ? (
            <p className="text-destructive">讀不到系上借用系統：{days}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <RoomStripLegend />
              <div className="flex flex-col gap-2">
                {days.map((day) => (
                  <RoomStrip
                    key={day.date}
                    label={dayLabel(day.date)}
                    slots={day.slots}
                    onPick={(index) => {
                      setOpen(false)
                      setPicked({ day, index })
                    }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-muted-foreground tabular-nums">
                <span>08:00</span>
                <span>15:00</span>
                <span>22:00</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {picked && (
        <MeetingDialog
          key={`${picked.day.date}-${picked.index}`}
          day={picked.day}
          index={picked.index}
          groups={groups}
          members={members}
          onClose={() => setPicked(null)}
        />
      )}
    </>
  )
}

function MeetingDialog({
  day,
  index,
  groups,
  members,
  onClose,
}: {
  day: Day
  index: number
  groups: RoomGroup[]
  members: People
  onClose: () => void
}) {
  const start = day.slots[index].start
  const left = (day.slots.length - index) * SLOT_MINUTES
  const [minutes, setMinutes] = React.useState(Math.min(60, left))
  const [online, setOnline] = React.useState(false)
  const [allowPaid, setAllowPaid] = React.useState(false)
  // 0 once; 1 every week; 2 every other week.
  const [repeat, setRepeat] = React.useState(0)
  const [meeting, setMeeting] = React.useState<MeetingValue>(emptyMeeting)
  const end = addMinutes(start, minutes)!
  const room = pickRoom(day.slots, start, end)
  const durations = [
    ...new Set([...DURATION_PRESETS, minutes].filter((m) => m <= left)),
  ].sort((a, b) => a - b)

  async function submitSeries() {
    const { result, error } = await createSeriesAction({
      weekday: weekdayOf(day.date),
      start_date: day.date,
      start_time: start,
      duration_minutes: minutes,
      interval_weeks: repeat,
      ...meetingInput(meeting),
    })
    if (error) {
      toast.error(error)
      throw new Error(error)
    }
    if (result!.errors.length)
      toast.warning(`已建立，但沒訂到：${result!.errors.join("；")}`)
    else
      toast.success(
        result!.booked
          ? `已建立，先訂好 ${result!.booked} 場`
          : "已建立，開會前 7 天會自動訂"
      )
  }

  async function submit() {
    if (repeat) return submitSeries()
    if (!online && !room) {
      toast.error("這段時間沒有教室從頭到尾都空著")
      throw new Error("no room")
    }
    if (!online && room?.paid && !allowPaid) {
      toast.error("只剩付費教室，要借請打開「同意付費」")
      throw new Error("paid")
    }
    const { result, error } = await bookRoomAction({
      date: day.date,
      start_time: start,
      end_time: end,
      online_only: online,
      allow_paid: allowPaid,
      ...meetingInput(meeting),
    })
    if (error) {
      toast.error(error)
      throw new Error(error)
    }
    toast.success(
      result!.room
        ? `已借 ${result!.room}，邀請信寄出中`
        : "已開線上會議，邀請信寄出中"
    )
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`${dayLabel(day.date)} ${start} 到 ${end}`}
      size="wide"
      submitLabel={repeat ? "新增" : online ? "開會議" : "預約"}
      pendingLabel={repeat ? "新增中…" : "預約中…"}
      onSubmit={submit}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="book-duration">時長</Label>
        <Select
          value={String(minutes)}
          onValueChange={(next) => setMinutes(Number(next))}
          items={durations.map((m) => ({
            value: String(m),
            label: `${m} 分鐘`,
          }))}
        >
          <SelectTrigger id="book-duration" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {durations.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {m} 分鐘
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="book-repeat">重複</Label>
        <Select
          value={String(repeat)}
          onValueChange={(next) => setRepeat(Number(next))}
          items={[
            { value: "0", label: "不重複" },
            { value: "1", label: "每週" },
            { value: "2", label: "隔週" },
          ]}
        >
          <SelectTrigger id="book-repeat" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">不重複</SelectItem>
            <SelectItem value="1">每週</SelectItem>
            <SelectItem value="2">隔週</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {!repeat && (
        <>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="book-online">只開線上會議，不借教室</Label>
            <Switch
              id="book-online"
              checked={online}
              onCheckedChange={setOnline}
            />
          </div>
          {!online && (
            <p className={room ? undefined : "text-destructive"}>
              {room
                ? `會借 ${room.room}（${room.paid ? "付費" : "免費"}）`
                : "這段時間沒有教室從頭到尾都空著"}
            </p>
          )}
          {!online && room?.paid && (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="book-paid">同意付費</Label>
              <Switch
                id="book-paid"
                checked={allowPaid}
                onCheckedChange={setAllowPaid}
              />
            </div>
          )}
        </>
      )}
      <MeetingFields
        value={meeting}
        onChange={setMeeting}
        groups={groups}
        members={members}
        syncOnly={repeat > 0}
      />
    </FormDialog>
  )
}
