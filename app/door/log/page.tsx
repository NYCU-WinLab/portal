import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { StatusPage } from "@/components/status-page"
import { NumberTicker } from "@/components/ui/number-ticker"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { type DoorEvent, listDoorEvents } from "@/lib/actions/door"
import { requireActor } from "@/lib/auth/session"
import { cn } from "@/lib/utils"

import { doorAdminNav, doorPage } from "../nav"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 100

const sources = { web: "網頁", mcp: "MCP", card: "刷卡" } as const

const day = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "numeric",
  day: "numeric",
  weekday: "short",
})
const time = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

function outcome(event: DoorEvent) {
  if (event.ok === null) return `事件 ${event.eventCode}`
  if (event.source === "card") return event.ok ? "通過" : "拒絕"
  return event.ok ? "已開" : "失敗"
}

export default async function DoorLogPage({
  searchParams,
}: PageProps<"/door/log">) {
  const actor = await requireActor("/door/log")
  if (!(await isAdmin(actor, "door")))
    return (
      <PortalShell page={doorPage} layout="spotlight">
        <StatusPage title="開門紀錄只有門禁管理員能看" />
      </PortalShell>
    )
  const params = await searchParams
  const source =
    typeof params.source === "string" && Object.hasOwn(sources, params.source)
      ? (params.source as keyof typeof sources)
      : undefined
  const before =
    typeof params.before === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      params.before
    )
      ? params.before
      : undefined
  const { events } = await runAction(listDoorEvents, actor, {
    limit: PAGE_SIZE,
    source,
    before,
  })
  const todayKey = day.format(new Date())
  const today = before
    ? null
    : events.filter((event) => day.format(event.at) === todayKey && event.ok)
  const days = new Map<string, DoorEvent[]>()
  for (const event of events) {
    const key = day.format(event.at)
    days.set(key, [...(days.get(key) ?? []), event])
  }
  const link = (next: { source?: string; before?: string }) => {
    const query = new URLSearchParams(
      Object.entries(next).filter(([, value]) => value) as [string, string][]
    ).toString()
    return query ? `/door/log?${query}` : "/door/log"
  }
  const oldest = events.at(-1)

  return (
    <PortalShell page={doorPage} nav={doorAdminNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="開門紀錄" />
        {today && (
          <Focus>
            <FocusLabel>今天</FocusLabel>
            <FocusTitle>
              {today.length === 0 ? (
                "還沒有人開門"
              ) : (
                <>
                  開了{" "}
                  <FocusHighlight>
                    <NumberTicker value={today.length} />
                  </FocusHighlight>{" "}
                  次門
                </>
              )}
            </FocusTitle>
          </Focus>
        )}
        <nav className="flex gap-4">
          {[undefined, ...Object.keys(sources)].map((key) => (
            <Link
              key={key ?? "all"}
              href={link({ source: key })}
              className={cn(
                "transition-colors duration-state hover:text-foreground",
                key === source ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {key ? sources[key as keyof typeof sources] : "全部"}
            </Link>
          ))}
        </nav>
        {events.length === 0 ? (
          <EmptyState noun="開門紀錄" />
        ) : (
          [...days].map(([date, rows]) => (
            <section key={date} className="flex flex-col gap-2">
              <SectionHeader title={date} />
              <ul className="flex flex-col">
                {rows.map((event) => (
                  <li
                    key={event.id}
                    className="flex min-h-14 items-center gap-4 border-b border-border py-2"
                  >
                    <span className="w-20 shrink-0 text-muted-foreground tabular-nums">
                      {time.format(event.at)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {event.name}
                      {event.cardId && (
                        <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                          {event.cardId}
                        </span>
                      )}
                    </span>
                    <span className="w-16 shrink-0 text-muted-foreground">
                      {sources[event.source]}
                    </span>
                    <span
                      className={cn(
                        "w-24 shrink-0 text-right",
                        event.ok === false
                          ? "text-destructive"
                          : event.ok === null && "text-muted-foreground"
                      )}
                      title={event.error ?? undefined}
                    >
                      {event.source === "card" && event.error
                        ? event.error
                        : outcome(event)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        {oldest && events.length === PAGE_SIZE && (
          <Link
            href={link({ source, before: oldest.id })}
            className="self-center text-muted-foreground transition-colors duration-state hover:text-foreground"
          >
            更早
          </Link>
        )}
      </div>
    </PortalShell>
  )
}
