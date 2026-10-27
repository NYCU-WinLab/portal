import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { runAction } from "@/lib/actions/define"
import {
  listMyDoorCards,
  listMyDoorEvents,
  type MyDoorEvent,
} from "@/lib/actions/door-mine"
import { requireActor } from "@/lib/auth/session"
import { cn } from "@/lib/utils"

import { doorNav, doorPage, recordTabs } from "../nav"
import { DoorTabs } from "../tabs"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 100

const sources = {
  web: "網頁",
  mcp: "MCP",
  api: "API",
  card: "刷卡",
} as const

const syncStates: Record<string, string> = {
  synced: "在卡機上",
  missing: "卡機上沒有",
  unknown: "未確認",
  deleting: "刪除中",
}

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
const date = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "numeric",
  day: "numeric",
})

function outcome(event: MyDoorEvent) {
  if (event.ok === null) return `事件 ${event.eventCode}`
  if (event.source === "card")
    return event.ok ? "通過" : (event.error ?? "拒絕")
  return event.ok ? "已開" : "失敗"
}

// A member's own cards and openings, so they can check their card works
// and notice a card or key used when they did not use it.
export default async function MyDoorPage({
  searchParams,
}: PageProps<"/door/mine">) {
  const actor = await requireActor("/door/mine")
  const params = await searchParams
  const before =
    typeof params.before === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      params.before
    )
      ? params.before
      : undefined
  const [{ cards }, { events }] = await Promise.all([
    runAction(listMyDoorCards, actor, {}),
    runAction(listMyDoorEvents, actor, { limit: PAGE_SIZE, before }),
  ])
  const days = new Map<string, MyDoorEvent[]>()
  for (const event of events) {
    const key = day.format(event.at)
    days.set(key, [...(days.get(key) ?? []), event])
  }
  const oldest = events.at(-1)

  return (
    <PortalShell page={doorPage} nav={doorNav}>
      <div className="flex flex-col gap-12">
        <DoorTabs actor={actor} tabs={recordTabs} current="/door/mine" />
        <PageHeader title="我的紀錄" />
        {!before && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="門禁卡" />
            {cards.length === 0 ? (
              <EmptyState noun="門禁卡" />
            ) : (
              <ul className="flex flex-col">
                {cards.map((card) => (
                  <li
                    key={card.card}
                    className="flex min-h-14 items-center gap-4 border-b border-border py-2"
                  >
                    <span className="w-28 shrink-0 tabular-nums">
                      {card.card}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {card.holderName}
                      {card.note && (
                        <span className="ml-2 text-muted-foreground">
                          {card.note}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {date.format(card.createdAt)}
                    </span>
                    <span
                      className={cn(
                        "w-24 shrink-0 text-right",
                        card.syncState !== "synced" && "text-destructive"
                      )}
                    >
                      {syncStates[card.syncState] ?? card.syncState}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {events.length === 0 ? (
          <EmptyState noun="開門紀錄" />
        ) : (
          [...days].map(([key, rows]) => (
            <section key={key} className="flex flex-col gap-2">
              <SectionHeader title={key} />
              <ul className="flex flex-col">
                {rows.map((event) => (
                  <li
                    key={event.id}
                    className="flex min-h-14 items-center gap-4 border-b border-border py-2"
                  >
                    <span className="w-20 shrink-0 text-muted-foreground tabular-nums">
                      {time.format(event.at)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {sources[event.source]}
                      {(event.card ?? event.key) && (
                        <span className="ml-2 text-muted-foreground tabular-nums">
                          {event.card ?? event.key}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "w-24 shrink-0 text-right",
                        event.ok === false
                          ? "text-destructive"
                          : event.ok === null && "text-muted-foreground"
                      )}
                    >
                      {outcome(event)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        {oldest && events.length === PAGE_SIZE && (
          <Link
            href={`/door/mine?before=${oldest.id}`}
            className="self-center text-muted-foreground transition-colors duration-state hover:text-foreground"
          >
            更早
          </Link>
        )}
      </div>
    </PortalShell>
  )
}
