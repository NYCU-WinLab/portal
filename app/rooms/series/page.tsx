import { EmptyState } from "@/components/empty-state"
import { ExpandRow } from "@/components/expand-row"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listMembers } from "@/lib/actions/admins"
import { runAction } from "@/lib/actions/define"
import { listRoomGroups } from "@/lib/actions/rooms"
import { listRoomSeries } from "@/lib/actions/rooms-series"
import { requireActor } from "@/lib/auth/session"
import { addMinutes, dayLabel } from "@/lib/rooms/time"

import { roomsNav, roomsPage } from "../nav"
import { SeriesButtons } from "./series-buttons"
import { SeriesForm } from "./series-form"

export const dynamic = "force-dynamic"

const weekdays = "日一二三四五六"

export default async function SeriesPage() {
  const actor = await requireActor("/rooms/series")
  const [{ series }, groups, members] = await Promise.all([
    runAction(listRoomSeries, actor, {}),
    runAction(listRoomGroups, actor, {}).then(
      ({ groups }) => groups,
      () => []
    ),
    runAction(listMembers, actor, {}),
  ])

  return (
    <PortalShell page={roomsPage} nav={roomsNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="固定會議"
          actions={<SeriesForm groups={groups} members={members} />}
        />
        {series.length === 0 ? (
          <EmptyState noun="固定會議" />
        ) : (
          <ul className="flex stagger-rise flex-col">
            {series.map((s) => (
              <ExpandRow
                key={s.id}
                summary={
                  <span className="flex gap-4">
                    <span className="w-44 shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
                      {s.intervalWeeks === 2 ? "隔週" : "每週"}
                      {weekdays[s.weekday]} {s.startTime} 到{" "}
                      {addMinutes(s.startTime, s.durationMinutes)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {!s.active
                        ? "暫停中"
                        : s.nextDate
                          ? `${dayLabel(s.nextDate)} ${s.nextBooked ? (s.nextRoom ?? "線上") : "未訂"}`
                          : ""}
                    </span>
                  </span>
                }
                actions={
                  s.createdBy === actor.userId && (
                    <SeriesButtons
                      id={s.id}
                      title={s.title}
                      active={s.active}
                    />
                  )
                }
              >
                <div className="flex flex-col gap-1 text-muted-foreground">
                  <div>建立者：{s.createdByName}</div>
                  {s.attendees.length > 0 && (
                    <div>與會：{s.attendees.map((a) => a.name).join("、")}</div>
                  )}
                  {s.includeAdvisor && <div>邀請老師</div>}
                  {s.agenda && (
                    <div className="whitespace-pre-wrap">{s.agenda}</div>
                  )}
                </div>
              </ExpandRow>
            ))}
          </ul>
        )}
      </div>
    </PortalShell>
  )
}
