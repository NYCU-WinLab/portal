import * as React from "react"

import { cn } from "@/lib/utils"

export type WeekEvent = {
  /** Unique within the week; defaults to start, end and title. */
  id?: string
  title: string
  start: string | Date
  end: string | Date
  allDay?: boolean
  /** Shown but not the member's to read, such as a busy block. */
  quiet?: boolean
}

const WEEKDAYS = "日一二三四五六"
const DAY = 24 * 60 * 60 * 1000
const FULL = 24 * 60

// Calendar days are YYYY-MM-DD strings, so they compare as text.
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay()
const pad = (n: number) => String(n).padStart(2, "0")

type Placed = WeekEvent & {
  key: string
  first: string
  last: string
  startMinute: number
  endMinute: number
  span: string
}

type Block = {
  event: Placed
  from: number
  to: number
  lane: number
  lanes: number
}

// The timed events of one day, cut to the day, side by side where they
// overlap: each cluster of overlapping events shares the column in lanes.
function blocks(day: string, events: Placed[]): Block[] {
  const items = events
    .filter((e) => !e.allDay && e.first <= day && e.last >= day)
    .map((event) => ({
      event,
      from: event.first === day ? event.startMinute : 0,
      to: event.last === day ? event.endMinute : FULL,
      lane: 0,
      lanes: 1,
    }))
    .sort((a, b) => a.from - b.from || b.to - a.to)
  let cluster: typeof items = []
  let clusterEnd = -1
  const close = () => {
    const lanes = Math.max(...cluster.map((item) => item.lane)) + 1
    for (const item of cluster) item.lanes = lanes
  }
  for (const item of items) {
    if (item.from >= clusterEnd && cluster.length) {
      close()
      cluster = []
    }
    const taken = new Set(
      cluster.filter((other) => other.to > item.from).map((o) => o.lane)
    )
    while (taken.has(item.lane)) item.lane++
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, item.to)
  }
  if (cluster.length) close()
  return items
}

// One week the way the week view of Calendar draws it: days in columns,
// hours down the side, each timed event a block from its start to its end,
// all-day events as pills above the hours. The hours run 08:00 to 20:00 and
// stretch to fit any event outside them. Today's date sits in a primary
// circle. Below md the columns fold into one row per day, listing events.
function WeekCalendar({
  from,
  events,
  today,
  days = 7,
  timeZone = "Asia/Taipei",
  className,
}: {
  /** The first day, YYYY-MM-DD in timeZone. */
  from: string
  events: WeekEvent[]
  /** YYYY-MM-DD in timeZone; that day's date is circled. */
  today?: string
  days?: number
  timeZone?: string
  className?: string
}) {
  const scope = React.useId().replace(/:/g, "")
  const dayOf = new Intl.DateTimeFormat("en-CA", { timeZone })
  const clockParts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  const minuteOf = (date: Date) => {
    const parts = clockParts.formatToParts(date)
    const get = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value ?? 0)
    return get("hour") * 60 + get("minute")
  }
  const clock = (minute: number) =>
    `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`

  const list = Array.from({ length: days }, (_, i) => addDays(from, i))
  const placed: Placed[] = events.map((event) => {
    const start = new Date(event.start)
    const end = new Date(event.end)
    // An event ending at midnight belongs to the day before.
    const last = new Date(Math.max(start.getTime(), end.getTime() - 1))
    const startMinute = minuteOf(start)
    const endMinute =
      dayOf.format(end) === dayOf.format(last) ? minuteOf(end) : FULL
    return {
      ...event,
      key:
        event.id ??
        `${start.toISOString()}-${end.toISOString()}-${event.title}`,
      first: dayOf.format(start),
      last: dayOf.format(last),
      startMinute,
      endMinute,
      span: `${clock(startMinute)} 到 ${clock(endMinute % FULL)}`,
    }
  })
  const perDay = list.map((day) => ({
    day,
    allDay: placed.filter((e) => e.allDay && e.first <= day && e.last >= day),
    timed: blocks(day, placed),
  }))

  const all = perDay.flatMap((d) => d.timed)
  const startHour = Math.min(8, ...all.map((b) => Math.floor(b.from / 60)))
  const endHour = Math.max(20, ...all.map((b) => Math.ceil(b.to / 60)))
  const hours = Array.from(
    { length: endHour - startHour },
    (_, i) => startHour + i
  )
  const total = (endHour - startHour) * 60
  const percent = (n: number) => `${((n / total) * 100).toFixed(3)}%`
  const rules = perDay
    .flatMap(({ timed }, d) =>
      timed.map(
        (b, i) =>
          `[data-week-scope=${scope}] [data-block="${d}-${i}"] { --top: ${percent(b.from - startHour * 60)}; --height: ${percent(b.to - b.from)}; --left: ${((b.lane / b.lanes) * 100).toFixed(3)}%; --width: ${(100 / b.lanes).toFixed(3)}%; }`
      )
    )
    .join("\n")
  const hasAllDay = perDay.some((d) => d.allDay.length)

  const dateLabel = (day: string, index: number) => {
    const date = Number(day.slice(8))
    return index === 0 || date === 1
      ? `${Number(day.slice(5, 7))}/${date}`
      : date
  }
  const dateCircle = (day: string, index: number) => (
    <span
      className={cn(
        "flex h-8 min-w-8 items-center justify-center rounded-full px-1 font-medium tabular-nums",
        day === today && "bg-primary text-primary-foreground"
      )}
    >
      {dateLabel(day, index)}
    </span>
  )
  const pill = (event: Placed) => (
    <li
      key={event.key}
      title={event.title}
      className={cn(
        "truncate rounded-full bg-muted px-2",
        event.quiet && "text-muted-foreground"
      )}
    >
      {event.title}
    </li>
  )

  return (
    <div
      data-slot="week-calendar"
      data-week-scope={scope}
      className={className}
    >
      <style>{rules}</style>

      {/* md and up: the time grid. */}
      <div className="hidden border-y border-border md:block">
        <div className="flex border-b border-border">
          <div className="w-14 shrink-0" />
          <div className="grid flex-1 grid-cols-7">
            {list.map((day, index) => (
              <div key={day} className="flex items-center gap-2 px-2 py-3">
                <span className="text-muted-foreground">
                  {WEEKDAYS[weekday(day)]}
                </span>
                {dateCircle(day, index)}
              </div>
            ))}
          </div>
        </div>
        {hasAllDay && (
          <div className="flex border-b border-border">
            <div className="w-14 shrink-0 py-2 text-muted-foreground">整天</div>
            <div className="grid flex-1 grid-cols-7 divide-x divide-border">
              {perDay.map(({ day, allDay }) => (
                <ul key={day} className="flex min-w-0 flex-col gap-1 p-1">
                  {allDay.map(pill)}
                </ul>
              ))}
            </div>
          </div>
        )}
        <div className="flex">
          <div className="w-14 shrink-0">
            {hours.map((hour) => (
              <div
                key={hour}
                className="h-12 pr-2 text-muted-foreground tabular-nums"
              >
                <span className="relative -top-3 bg-background">
                  {hour === startHour ? "" : `${pad(hour)}:00`}
                </span>
              </div>
            ))}
          </div>
          <div className="relative grid flex-1 grid-cols-7 divide-x divide-border">
            <div aria-hidden className="pointer-events-none absolute inset-0">
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="h-12 border-t border-border first:border-t-0"
                />
              ))}
            </div>
            {perDay.map(({ day, timed }, d) => (
              <ul key={day} aria-label={day} className="relative min-w-0">
                {timed.map((b, i) => (
                  <li
                    key={b.event.key}
                    data-block={`${d}-${i}`}
                    title={`${b.event.title}，${b.event.span}`}
                    className="absolute top-(--top) left-(--left) h-(--height) w-(--width) p-px"
                  >
                    <div
                      className={cn(
                        "flex size-full min-h-6 flex-col overflow-hidden border-l-2 px-2",
                        b.event.quiet
                          ? "border-muted-foreground bg-muted text-muted-foreground"
                          : "border-primary bg-primary/10"
                      )}
                    >
                      <span
                        className={cn(
                          "truncate",
                          !b.event.quiet && "font-medium"
                        )}
                      >
                        {b.event.title}
                      </span>
                      <span className="truncate text-muted-foreground tabular-nums">
                        {clock(b.event.startMinute)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </div>

      {/* Below md: one row per day. */}
      <div className="border-y border-border md:hidden">
        {perDay.map(({ day, allDay, timed }, index) => (
          <section
            key={day}
            aria-label={day}
            className="flex min-w-0 gap-4 border-b border-border py-3 last:border-b-0"
          >
            <header className="flex h-8 w-16 shrink-0 items-center gap-2 self-start">
              <span className="text-muted-foreground">
                {WEEKDAYS[weekday(day)]}
              </span>
              {dateCircle(day, index)}
            </header>
            <ul className="flex min-w-0 flex-1 flex-col gap-1">
              {allDay.map(pill)}
              {timed.map((b) => (
                <li
                  key={b.event.key}
                  className={cn(
                    "flex min-w-0 flex-col border-l-2 pl-2",
                    b.event.quiet ? "border-muted-foreground" : "border-primary"
                  )}
                >
                  <span
                    className={cn(
                      "truncate font-medium",
                      b.event.quiet && "font-normal text-muted-foreground"
                    )}
                  >
                    {b.event.title}
                  </span>
                  <span className="truncate text-muted-foreground tabular-nums">
                    {b.event.span}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

export { WeekCalendar }
