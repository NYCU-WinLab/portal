import { EmptyState } from "@/components/empty-state"
import { ExpandRow } from "@/components/expand-row"
import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusMeta,
  FocusTitle,
} from "@/components/focus"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listMembers } from "@/lib/actions/admins"
import { runAction } from "@/lib/actions/define"
import { listRoomBookings, listRoomGroups } from "@/lib/actions/rooms"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"
import { dayLabel, todayInTaipei } from "@/lib/rooms/time"

import { AvailabilityGrid } from "./availability-grid"
import { CancelButton } from "./cancel-button"
import { roomsNav, roomsPage } from "./nav"

export const dynamic = "force-dynamic"

type Booking = Awaited<
  ReturnType<typeof listRoomBookings.run>
>["bookings"][number]

const meetingText = (booking: Booking) => {
  if (!booking.meeting) return null
  if (booking.meeting.status === "success") return "Teams 會議已建立"
  if (booking.meeting.status === "pending") return "Teams 會議建立中"
  return `Teams 會議沒有建成：${booking.meeting.error ?? "原因不明"}`
}

export default async function RoomsPage() {
  const actor = await requireActor("/rooms")
  const today = todayInTaipei()
  const [me, { bookings }, groups, members] = await Promise.all([
    runAction(whoami, actor, {}),
    runAction(listRoomBookings, actor, { date: today, days: 30 }),
    // Keycloak being down leaves booking without groups, not broken.
    runAction(listRoomGroups, actor, {}).then(
      ({ groups }) => groups,
      () => []
    ),
    runAction(listMembers, actor, {}),
  ])
  const upcoming = bookings.filter((b) => b.status === "booked")
  const mine = upcoming.find(
    (b) =>
      b.requestedBy === actor.userId ||
      b.attendees.some((a) => a.email === me.email)
  )
  const days = [...new Set(upcoming.map((b) => b.date))]

  return (
    <PortalShell page={roomsPage} nav={roomsNav} layout="wide">
      <div className="flex flex-col gap-12">
        <PageHeader title="會議" />
        <Focus>
          <FocusLabel>你的下一場會議</FocusLabel>
          <FocusTitle>
            {mine ? (
              <>
                <FocusHighlight>
                  {dayLabel(mine.date)} {mine.startTime}
                </FocusHighlight>{" "}
                {mine.title}
              </>
            ) : (
              "沒有"
            )}
          </FocusTitle>
          {mine && (
            <FocusMeta>
              <span>{mine.room ? `資工系 ${mine.room}` : "線上"}</span>
              {mine.meeting?.status === "success" && (
                <a
                  href={`/rooms/join/${mine.id}`}
                  className="text-foreground underline underline-offset-4"
                >
                  加入 Teams 會議
                </a>
              )}
            </FocusMeta>
          )}
        </Focus>
        <section className="flex flex-col gap-4">
          <SectionHeader title="系上教室空檔" />
          <AvailabilityGrid today={today} groups={groups} members={members} />
        </section>
        {days.length === 0 ? (
          <EmptyState noun="會議" />
        ) : (
          days.map((date) => (
            <section key={date} className="flex flex-col gap-2">
              <SectionHeader title={dayLabel(date)} />
              <ul className="flex stagger-rise flex-col">
                {upcoming
                  .filter((b) => b.date === date)
                  .map((b) => (
                    <ExpandRow
                      key={b.id}
                      summary={
                        <span className="flex gap-4">
                          <span className="w-32 shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
                            {b.startTime} 到 {b.endTime}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {b.title}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {b.room ?? "線上"}
                          </span>
                        </span>
                      }
                      actions={
                        b.requestedBy === actor.userId && (
                          <CancelButton id={b.id} title={b.title} />
                        )
                      }
                    >
                      <dl className="flex flex-col gap-1 text-muted-foreground">
                        <div>發起人：{b.requestedByName}</div>
                        {b.attendees.length > 0 && (
                          <div>
                            與會：{b.attendees.map((a) => a.name).join("、")}
                          </div>
                        )}
                        {b.agenda && (
                          <div className="whitespace-pre-wrap">{b.agenda}</div>
                        )}
                        {meetingText(b) && <div>{meetingText(b)}</div>}
                        {b.meeting?.status === "success" && (
                          <a
                            href={`/rooms/join/${b.id}`}
                            className="text-foreground underline underline-offset-4"
                          >
                            加入 Teams 會議
                          </a>
                        )}
                      </dl>
                    </ExpandRow>
                  ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </PortalShell>
  )
}
