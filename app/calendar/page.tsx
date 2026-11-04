import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { NumberTicker } from "@/components/ui/number-ticker"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { getMyCalendar, listCalendars } from "@/lib/actions/calendar"
import { runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"

import { MyCalendar } from "./my-calendar"
import { calendarPage } from "./nav"

export const dynamic = "force-dynamic"

const problems: Record<string, string> = {
  "not-configured": "行事曆沒有設定 Google 登入",
  state: "連結逾時或來源不符，請再試一次",
  denied: "Google 沒有授權",
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const actor = await requireActor("/calendar")
  const [{ error }, mine, { calendars }] = await Promise.all([
    searchParams,
    runAction(getMyCalendar, actor, {}),
    runAction(listCalendars, actor, {}),
  ])
  const free = calendars.filter((row) => !row.busyNow).length

  return (
    <PortalShell page={calendarPage}>
      <div className="flex flex-col gap-12">
        <PageHeader title="行事曆" />
        <Focus>
          <FocusLabel>現在</FocusLabel>
          <FocusTitle>
            <FocusHighlight>
              <NumberTicker value={free} />
            </FocusHighlight>{" "}
            人有空，{calendars.length - free} 人忙碌
          </FocusTitle>
        </Focus>
        <section className="flex flex-col gap-2">
          <SectionHeader title="我的行事曆" />
          {error && (
            <p className="text-destructive">{problems[error] ?? error}</p>
          )}
          {mine.configured || mine.link ? (
            <MyCalendar link={mine.link} />
          ) : (
            <p className="text-muted-foreground">行事曆沒有設定 Google 登入</p>
          )}
        </section>
        <section className="flex flex-col gap-2">
          <SectionHeader title="大家的行事曆" />
          {calendars.length === 0 ? (
            <EmptyState noun="行事曆" />
          ) : (
            <ul className="flex stagger-rise flex-col">
              {calendars.map((row) => (
                <li key={row.userId}>
                  <Link
                    prefetch
                    href={`/calendar/${row.userId}`}
                    className="flex min-h-14 items-center gap-4 border-b border-border py-2 hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {row.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {row.visibility === "public" ? "公開" : "只顯示忙碌"}
                    </span>
                    <span
                      className={
                        row.busyNow
                          ? "w-12 shrink-0 text-right text-warning"
                          : "w-12 shrink-0 text-right text-success"
                      }
                    >
                      {row.busyNow ? "忙碌" : "有空"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PortalShell>
  )
}
