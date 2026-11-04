import Link from "next/link"

import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { MemberAvatar } from "@/components/member-avatar"
import { PortalShell } from "@/components/portal-shell"
import { buttonVariants } from "@/components/ui/button"
import { WeekCalendar } from "@/components/week-calendar"
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

import { calendarNav, calendarPage } from "../nav"
import { SubscribeButton } from "../subscribe-button"
import { BookSlots } from "./book-slot"
import { CalendarTabs } from "./calendar-tabs"

export const dynamic = "force-dynamic"

const DAYS = 7
// Weeks start on Monday, as the lab's week runs.
const mondayOf = (day: string) =>
  addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7))
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
  const today = todayInTaipei()
  const thisWeek = mondayOf(today)
  const from = mondayOf(
    query.from && isCalendarDay(query.from) ? query.from : today
  )
  const [calendar, slots] = await Promise.all([
    runAction(getMemberCalendar, actor, { user_id: id, from, days: DAYS }),
    runAction(listAppointmentSlots, actor, { user_id: id }),
  ])
  const bookable = slots.schedule && id !== actor.userId
  const soonest = slots.days[0]

  const week = (from: string, label: string) => (
    <Link
      prefetch
      href={`/calendar/${id}?tab=schedule&from=${from}`}
      className={buttonVariants({ variant: "outline" })}
    >
      {label}
    </Link>
  )
  const schedule = (
    <section className="flex flex-col gap-6">
      <SectionHeader
        title={`${dayLabel(from)} 到 ${dayLabel(addDays(from, DAYS - 1))}`}
        actions={
          <>
            {week(addDays(from, -DAYS), "上一週")}
            {from !== thisWeek && week(thisWeek, "本週")}
            {week(addDays(from, DAYS), "下一週")}
          </>
        }
      />
      <WeekCalendar
        className="stagger-rise"
        from={from}
        today={today}
        days={DAYS}
        events={calendar.events.map((event) => ({
          title: event.title,
          start: event.start,
          end: event.end,
          allDay: event.allDay,
          quiet: event.busyOnly,
        }))}
      />
    </section>
  )

  return (
    <PortalShell page={calendarPage} nav={calendarNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title={
            <span className="flex items-center gap-3">
              <MemberAvatar id={id} name={calendar.name} />
              {calendar.name}
            </span>
          }
          actions={<SubscribeButton url={calendar.feedUrl} />}
        />
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
