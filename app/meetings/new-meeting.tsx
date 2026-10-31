"use client"

import * as React from "react"
import { toast } from "sonner"

import { FormDialog } from "@/components/form-dialog"
import type { Member } from "@/components/member-combobox"
import {
  RoomStrip,
  RoomStripAxis,
  RoomStripLegend,
} from "@/components/room-strip"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { pickRoom, type Slot } from "@/lib/rooms/availability"
import {
  DURATION_PRESETS,
  ONLINE_AHEAD_DAYS,
  ONLINE_MAX_MINUTES,
  SLOT_MINUTES,
  addDays,
  clock,
  dayLabel,
  endAfter,
} from "@/lib/rooms/time"

import {
  MeetingFields,
  emptyMeeting,
  meetingInput,
  type MeetingValue,
  type RoomGroup,
} from "./meeting-fields"
import { bookMeetingAction, loadAvailability } from "./rooms-actions"

const DAYS = 14

type Day = { date: string; slots: Slot[] }
type People = (Member & { username: string | null })[]

// 新增會議: two weeks of department rooms, read live when it opens. Press a
// cell to fill in the meeting from there, once or every week. The 只開線上
// tab skips the rooms: any day up to 90 ahead, any half hour of the day.
export function NewMeeting({
  today,
  groups,
  members,
  username,
}: {
  today: string
  groups: RoomGroup[]
  members: People
  /** The member's own, which prefixes a meeting without a group. */
  username: string | null
}) {
  const [open, setOpen] = React.useState(false)
  const [days, setDays] = React.useState<Day[] | string | null>(null)
  const [picked, setPicked] = React.useState<Picked | null>(null)

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
            <DialogTitle>新增會議</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="room">
            <TabsList>
              <TabsTrigger value="room">借教室</TabsTrigger>
              <TabsTrigger value="online">只開線上</TabsTrigger>
            </TabsList>
            <TabsContent value="room" className="pt-4">
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
                          setPicked({
                            date: day.date,
                            start: day.slots[index].start,
                            left: (day.slots.length - index) * SLOT_MINUTES,
                            slots: day.slots,
                          })
                        }}
                      />
                    ))}
                  </div>
                  <RoomStripAxis />
                </div>
              )}
            </TabsContent>
            <TabsContent value="online" className="pt-4">
              <OnlinePicker
                today={today}
                onPick={(next) => {
                  setOpen(false)
                  setPicked(next)
                }}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
      {picked && (
        <MeetingDialog
          key={`${picked.date}-${picked.start}-${picked.slots ? "room" : "online"}`}
          picked={picked}
          groups={groups}
          members={members}
          username={username}
          onClose={() => setPicked(null)}
        />
      )}
    </>
  )
}

/** Where a meeting starts and how long it may run; slots only when it may
 * take a department room. */
type Picked = {
  date: string
  start: string
  left: number
  slots: Slot[] | null
}

const halfHours = Array.from({ length: 48 }, (_, i) => clock(i * SLOT_MINUTES))

// A day and a start for a meeting with no room: today to 90 days ahead,
// any half hour; it may run until midnight.
function OnlinePicker({
  today,
  onPick,
}: {
  today: string
  onPick: (picked: Picked) => void
}) {
  const [date, setDate] = React.useState(today)
  const [start, setStart] = React.useState("21:00")
  const last = addDays(today, ONLINE_AHEAD_DAYS)
  const valid = date >= today && date <= last
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="online-date">日期</Label>
        <Input
          id="online-date"
          type="date"
          min={today}
          max={last}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="online-start">開始</Label>
        <Select
          value={start}
          onValueChange={(next) => setStart(String(next))}
          items={halfHours.map((t) => ({ value: t, label: t }))}
        >
          <SelectTrigger id="online-start" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {halfHours.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-muted-foreground">
        線上會議在 meet.winlab.tw 開，會錄影並自動做逐字稿與會議紀錄
      </p>
      <div className="flex justify-end">
        <Button
          disabled={!valid}
          onClick={() =>
            onPick({
              date,
              start,
              left: Math.min(
                ONLINE_MAX_MINUTES,
                24 * 60 - halfHours.indexOf(start) * SLOT_MINUTES
              ),
              slots: null,
            })
          }
        >
          下一步
        </Button>
      </div>
    </div>
  )
}

function MeetingDialog({
  picked,
  groups,
  members,
  username,
  onClose,
}: {
  picked: Picked
  groups: RoomGroup[]
  members: People
  username: string | null
  onClose: () => void
}) {
  const { date, start, left, slots } = picked
  const onlineOnly = slots === null
  const [minutes, setMinutes] = React.useState(Math.min(60, left))
  const [online, setOnline] = React.useState(onlineOnly)
  const [allowPaid, setAllowPaid] = React.useState(false)
  // 0 once; 1 every week; 2 every other week.
  const [repeat, setRepeat] = React.useState(0)
  const [meeting, setMeeting] = React.useState<MeetingValue>(emptyMeeting)
  const end = endAfter(start, minutes)!
  const room = slots ? pickRoom(slots, start, end) : null
  const presets = onlineOnly
    ? Array.from(
        { length: ONLINE_MAX_MINUTES / SLOT_MINUTES },
        (_, i) => (i + 1) * SLOT_MINUTES
      )
    : DURATION_PRESETS
  const durations = [
    ...new Set([...presets, minutes].filter((m) => m <= left)),
  ].sort((a, b) => a - b)

  async function submit() {
    if (!repeat && !online && !room) {
      toast.error("這段時間沒有教室從頭到尾都空著")
      throw new Error("no room")
    }
    if (!repeat && !online && room?.paid && !allowPaid) {
      toast.error("只剩付費教室，要借請打開「同意付費」")
      throw new Error("paid")
    }
    const { result, error } = await bookMeetingAction({
      date,
      start_time: start,
      end_time: end,
      online_only: !repeat && online,
      allow_paid: allowPaid,
      repeat: ["none", "weekly", "biweekly"][repeat],
      ...meetingInput(meeting),
    })
    if (error) {
      toast.error(error)
      throw new Error(error)
    }
    if ("standing_meeting" in result!) {
      if (result.errors.length)
        toast.warning(`已建立，但沒訂到：${result.errors.join("；")}`)
      else
        toast.success(
          result.booked
            ? `已建立，先訂好 ${result.booked} 場`
            : "已建立，開會前 7 天會自動訂"
        )
      return
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
      title={`${dayLabel(date)} ${start} 到 ${end}`}
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
      {!onlineOnly && (
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
      )}
      {!repeat && !onlineOnly && (
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
        username={username}
        syncOnly={repeat > 0}
      />
    </FormDialog>
  )
}
