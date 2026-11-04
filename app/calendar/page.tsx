import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { NumberTicker } from "@/components/ui/number-ticker"
import { getMyCalendar, listCalendars } from "@/lib/actions/calendar"
import { runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"

import { calendarNav, calendarPage } from "./nav"

export const dynamic = "force-dynamic"

export default async function CalendarPage() {
  const actor = await requireActor("/calendar")
  const [mine, { calendars }] = await Promise.all([
    runAction(getMyCalendar, actor, {}),
    runAction(listCalendars, actor, {}),
  ])
  const free = calendars.filter((row) => !row.busyNow).length

  return (
    <PortalShell page={calendarPage} nav={calendarNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="行事曆"
          actions={
            mine.configured &&
            !mine.link && (
              <a
                href="/api/calendar/google/connect"
                className={buttonVariants()}
              >
                連結 Google 行事曆
              </a>
            )
          }
        />
        {calendars.length > 0 && (
          <Focus>
            <FocusLabel>現在</FocusLabel>
            <FocusTitle>
              <FocusHighlight>
                <NumberTicker value={free} />
              </FocusHighlight>{" "}
              人有空，{calendars.length - free} 人忙碌
            </FocusTitle>
          </Focus>
        )}
        {calendars.length === 0 ? (
          <EmptyState noun="行事曆" />
        ) : (
          <ul className="flex stagger-rise flex-col">
            {calendars.map((row) => (
              <li key={row.userId}>
                <Link
                  prefetch
                  href={`/calendar/${row.userId}`}
                  className="flex min-h-14 items-center gap-4 border-b border-border py-2 transition-colors duration-state hover:bg-muted/50"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {row.name}
                  </span>
                  {row.bookable && <Badge>可預約</Badge>}
                  <Badge variant={row.busyNow ? "warning" : "success"}>
                    {row.busyNow ? "忙碌" : "有空"}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PortalShell>
  )
}
