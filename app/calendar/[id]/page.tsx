import Link from "next/link"

import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { buttonVariants } from "@/components/ui/button"
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
import { calendarPage } from "../nav"

export const dynamic = "force-dynamic"

const DAYS = 7
const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Taipei",
  hour: "2-digit",
  minute: "2-digit",
})
const synced = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

export default async function MemberCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const actor = await requireActor(`/calendar/${id}`)
  const from =
    query.from && isCalendarDay(query.from) ? query.from : todayInTaipei()
  const calendar = await runAction(getMemberCalendar, actor, {
    user_id: id,
    from,
    days: DAYS,
  })
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

  return (
    <PortalShell page={calendarPage}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title={calendar.name}
          actions={
            <div className="flex gap-2">
              <Link
                prefetch
                href={`/calendar/${id}?from=${addDays(from, -DAYS)}`}
                className={buttonVariants({ variant: "outline" })}
              >
                上一週
              </Link>
              <Link
                prefetch
                href={`/calendar/${id}?from=${addDays(from, DAYS)}`}
                className={buttonVariants({ variant: "outline" })}
              >
                下一週
              </Link>
            </div>
          }
        />
        <p className="text-muted-foreground">
          {calendar.visibility === "public" ? "公開" : "只顯示忙碌"}
          {calendar.syncedAt &&
            `，${synced.format(new Date(calendar.syncedAt))} 同步`}
        </p>
        {days.map((day) => {
          const events = eventsOn(day)
          return (
            <section key={day} className="flex flex-col gap-2">
              <SectionHeader title={dayLabel(day)} />
              {events.length === 0 ? (
                <p className="text-muted-foreground">整天有空</p>
              ) : (
                <ul className="flex flex-col">
                  {events.map((event) => (
                    <li
                      key={`${event.start}-${event.end}-${event.title}`}
                      className="flex min-h-14 items-center gap-4 border-b border-border py-2"
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
                            : "min-w-0 flex-1 truncate font-medium"
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
              )}
            </section>
          )
        })}
        <section className="flex flex-col gap-2">
          <SectionHeader title="我的專屬訂閱連結" />
          <FeedLink url={calendar.feedUrl} />
        </section>
      </div>
    </PortalShell>
  )
}
