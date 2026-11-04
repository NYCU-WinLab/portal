import Link from "next/link"

import { ExpandRow } from "@/components/expand-row"
import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { buttonVariants } from "@/components/ui/button"
import { listAppointmentSlots } from "@/lib/actions/appointments"
import { getMemberCalendar } from "@/lib/actions/calendar"
import { runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"
import {
  addDays,
  dayLabel,
  isCalendarDay,
  todayInTaipei,
} from "@/lib/rooms/time"

import { FeedLink } from "../feed-link"
import { calendarNav, calendarPage } from "../nav"
import { BookSlots } from "./book-slot"
import { CalendarTabs } from "./calendar-tabs"

export const dynamic = "force-dynamic"

const DAYS = 7
const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Taipei",
  hour: "2-digit",
  minute: "2-digit",
})

export default async function MemberCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string; tab?: string }>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const actor = await requireActor(`/calendar/${id}`)
  const from =
    query.from && isCalendarDay(query.from) ? query.from : todayInTaipei()
  const [calendar, slots] = await Promise.all([
    runAction(getMemberCalendar, actor, { user_id: id, from, days: DAYS }),
    runAction(listAppointmentSlots, actor, { user_id: id }),
  ])
  const bookable = slots.schedule && id !== actor.userId
  const days = Array.from({ length: DAYS }, (_, i) => addDays(from, i))
  const eventsOn = (day: string) => {
    const start = new Date(`${day}T00:00:00+08:00`).getTime()
    const end = new Date(`${addDays(day, 1)}T00:00:00+08:00`).getTime()
    return calendar.events.filter(
      (event) =>
        new Date(event.start).getTime() < end &&
        new Date(event.end).getTime() > start
    )
  }
  const soonest = slots.days[0]

  const schedule = (
    <section className="flex flex-col gap-6">
      <SectionHeader
        title={`${dayLabel(from)} 起 ${DAYS} 天`}
        actions={
          <>
            <Link
              prefetch
              href={`/calendar/${id}?tab=schedule&from=${addDays(from, -DAYS)}`}
              className={buttonVariants({ variant: "outline" })}
            >
              上一週
            </Link>
            <Link
              prefetch
              href={`/calendar/${id}?tab=schedule&from=${addDays(from, DAYS)}`}
              className={buttonVariants({ variant: "outline" })}
            >
              下一週
            </Link>
          </>
        }
      />
      <ul className="flex stagger-rise flex-col">
        {days.map((day) => {
          const events = eventsOn(day)
          if (!events.length)
            return (
              <li
                key={day}
                className="flex min-h-14 items-center gap-4 border-b border-border py-3"
              >
                <span className="font-medium">{dayLabel(day)}</span>
                <span className="text-muted-foreground">整天有空</span>
              </li>
            )
          return (
            <ExpandRow
              key={day}
              defaultOpen={day === from}
              summary={
                <span className="flex items-center gap-4">
                  <span className="font-medium">{dayLabel(day)}</span>
                  <span className="text-muted-foreground">
                    {events.length} 個行程
                  </span>
                </span>
              }
            >
              <ul className="flex flex-col gap-2">
                {events.map((event) => (
                  <li
                    key={`${event.start}-${event.end}-${event.title}`}
                    className="flex items-center gap-4"
                  >
                    <span className="w-32 shrink-0 text-muted-foreground tabular-nums">
                      {event.allDay
                        ? "整天"
                        : `${clock.format(new Date(event.start))} 到 ${clock.format(new Date(event.end))}`}
                    </span>
                    <span
                      className={
                        event.busyOnly
                          ? "min-w-0 flex-1 truncate text-muted-foreground"
                          : "min-w-0 flex-1 truncate"
                      }
                    >
                      {event.title}
                    </span>
                    {event.location && (
                      <span className="min-w-0 shrink truncate text-muted-foreground">
                        {event.location}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </ExpandRow>
          )
        })}
        <ExpandRow
          summary={<span className="font-medium">訂閱到我的行事曆 app</span>}
        >
          <FeedLink url={calendar.feedUrl} />
        </ExpandRow>
      </ul>
    </section>
  )

  return (
    <PortalShell page={calendarPage} nav={calendarNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title={calendar.name} />
        {bookable ? (
          <Focus>
            <FocusLabel>最快可以約</FocusLabel>
            <FocusTitle>
              {!slots.synced ? (
                "行事曆同步不了，暫停預約"
              ) : soonest ? (
                <FocusHighlight>
                  {dayLabel(soonest.date)} {soonest.starts[0]}
                </FocusHighlight>
              ) : (
                "近期都約滿了"
              )}
            </FocusTitle>
          </Focus>
        ) : (
          <Focus>
            <FocusLabel>現在</FocusLabel>
            <FocusTitle>
              {calendar.busyUntil ? (
                <>
                  <FocusHighlight>忙碌</FocusHighlight>，到{" "}
                  {clock.format(new Date(calendar.busyUntil))}
                </>
              ) : (
                <FocusHighlight>有空</FocusHighlight>
              )}
            </FocusTitle>
          </Focus>
        )}
        {bookable ? (
          <CalendarTabs
            defaultTab={query.tab === "schedule" ? "schedule" : "booking"}
            booking={
              slots.synced ? (
                <BookSlots
                  userId={id}
                  name={calendar.name}
                  slotMinutes={slots.slotMinutes}
                  days={slots.days}
                />
              ) : null
            }
            schedule={schedule}
          />
        ) : (
          schedule
        )}
      </div>
    </PortalShell>
  )
}
