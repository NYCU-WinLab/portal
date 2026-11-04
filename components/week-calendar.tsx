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

// Calendar days are YYYY-MM-DD strings, so they compare as text.
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay()

// One week of days in columns, each listing its events the way a month view
// of Calendar does: all-day events as pills on top, timed ones under them
// with a bar, the title and the start time (the whole span in the tip).
// Today's date sits in a primary circle.
// Below md the columns fold into one row per day.
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
  const dayOf = new Intl.DateTimeFormat("en-CA", { timeZone })
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  })
  const list = Array.from({ length: days }, (_, i) => addDays(from, i))
  const placed = events.map((event) => {
    const start = new Date(event.start)
    const end = new Date(event.end)
    // An event ending at midnight belongs to the day before.
    const last = new Date(Math.max(start.getTime(), end.getTime() - 1))
    return {
      ...event,
      key:
        event.id ??
        `${start.toISOString()}-${end.toISOString()}-${event.title}`,
      first: dayOf.format(start),
      last: dayOf.format(last),
      time: clock.format(start),
      span: `${clock.format(start)} 到 ${clock.format(end)}`,
      at: start.getTime(),
    }
  })

  return (
    <div
      data-slot="week-calendar"
      className={cn(
        "grid border-y border-border md:grid-cols-7 md:divide-x md:divide-border",
        className
      )}
    >
      {list.map((day, index) => {
        const on = placed
          .filter((event) => event.first <= day && event.last >= day)
          .sort(
            (a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.at - b.at
          )
        const date = Number(day.slice(8))
        const label =
          index === 0 || date === 1
            ? `${Number(day.slice(5, 7))}/${date}`
            : date
        return (
          <section
            key={day}
            aria-label={day}
            className="flex min-w-0 gap-4 border-b border-border py-3 last:border-b-0 md:min-h-40 md:flex-col md:gap-2 md:border-b-0 md:px-2"
          >
            <header className="flex h-8 w-16 shrink-0 items-center gap-2 self-start md:w-auto md:justify-between">
              <span className="text-muted-foreground">
                {WEEKDAYS[weekday(day)]}
              </span>
              <span
                className={cn(
                  "flex h-8 min-w-8 items-center justify-center rounded-full px-1 font-medium tabular-nums",
                  day === today && "bg-primary text-primary-foreground"
                )}
              >
                {label}
              </span>
            </header>
            <ul className="flex min-w-0 flex-1 flex-col gap-1">
              {on.map((event) =>
                event.allDay ? (
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
                ) : (
                  <li
                    key={event.key}
                    title={`${event.title}，${event.span}`}
                    className={cn(
                      "flex min-w-0 flex-col border-l-2 pl-2",
                      event.quiet ? "border-muted-foreground" : "border-primary"
                    )}
                  >
                    <span
                      className={cn(
                        "truncate font-medium",
                        event.quiet && "font-normal text-muted-foreground"
                      )}
                    >
                      {event.title}
                    </span>
                    <span className="truncate text-muted-foreground tabular-nums">
                      {event.time}
                    </span>
                  </li>
                )
              )}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

export { WeekCalendar }
