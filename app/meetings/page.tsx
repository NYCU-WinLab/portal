import { EmptyState } from "@/components/empty-state"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listMembers } from "@/lib/actions/admins"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listMeetings } from "@/lib/actions/meetings"
import type { ScheduledMeeting } from "@/lib/actions/meetings-shared"
import { listPapers } from "@/lib/actions/papers"
import { requireActor } from "@/lib/auth/session"
import { dateLabel, taipeiToday } from "@/lib/leave-dates"

import { AdminActions } from "./admin-actions"
import { MeetingActions } from "./meeting-actions"
import { meetingsNav, meetingsPage } from "./nav"

export const dynamic = "force-dynamic"

const kindLabel = { holiday: "放假", speaker: "演講", thesis: "碩論" } as const

function MeetingRow({
  meeting,
  actions,
}: {
  meeting: ScheduledMeeting
  actions?: React.ReactNode
}) {
  const what =
    meeting.kind === "holiday"
      ? meeting.holiday
      : meeting.paper?.url
        ? null
        : meeting.title
  return (
    <li className="flex min-h-14 flex-col gap-1 border-b border-border py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex w-44 shrink-0 gap-2 whitespace-nowrap tabular-nums">
        <span>{dateLabel(meeting.date)}</span>
        <span className="text-muted-foreground">{meeting.label}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          {meeting.kind !== "regular" && (
            <span className="text-muted-foreground">
              {kindLabel[meeting.kind]}
            </span>
          )}
          {meeting.presenter && (
            <span className="font-medium">{meeting.presenter.name}</span>
          )}
          {meeting.paper?.url ? (
            <a
              href={meeting.paper.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 underline-offset-4 hover:underline"
            >
              {meeting.paper.title}
            </a>
          ) : (
            what && <span className="min-w-0">{what}</span>
          )}
          {meeting.kind === "regular" && !meeting.presenter && (
            <span className="text-muted-foreground">未排</span>
          )}
        </div>
        {(meeting.questioners.length > 0 ||
          meeting.slidesUrl ||
          meeting.recordingUrl ||
          meeting.notes) && (
          <div className="flex flex-wrap gap-x-4 text-muted-foreground">
            {meeting.questioners.length > 0 && (
              <span>
                提問 {meeting.questioners.map((seat) => seat.name).join("、")}
              </span>
            )}
            {meeting.slidesUrl && (
              <a
                href={meeting.slidesUrl}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:underline"
              >
                投影片
              </a>
            )}
            {meeting.recordingUrl && (
              <a
                href={meeting.recordingUrl}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:underline"
              >
                錄影
              </a>
            )}
            {meeting.notes && <span>{meeting.notes}</span>}
          </div>
        )}
      </div>
      {actions}
    </li>
  )
}

export default async function MeetingsPage() {
  const actor = await requireActor("/meetings")
  const [{ meetings }, { meetings: past }, { papers }, admin] =
    await Promise.all([
      runAction(listMeetings, actor, {}),
      runAction(listMeetings, actor, { past: true }),
      runAction(listPapers, actor, {}),
      isAdmin(actor, "meetings"),
    ])
  const members = admin ? await runAction(listMembers, actor, {}) : []
  const paperOptions = papers.map((paper) => ({
    value: paper.id,
    label: paper.venue ? `${paper.title}（${paper.venue}）` : paper.title,
  }))
  const semesters = [...new Set(meetings.map((row) => row.semester))]
  const today = taipeiToday()

  const actionsFor = (meeting: ScheduledMeeting) => (
    <MeetingActions
      meeting={meeting}
      mine={meeting.presenter?.id === actor.userId}
      admin={admin}
      upcoming={meeting.date >= today}
      papers={paperOptions}
      members={members}
    />
  )

  return (
    <PortalShell page={meetingsPage} nav={meetingsNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="實驗室會議"
          actions={
            admin && (
              <AdminActions
                dates={meetings
                  .filter(
                    (row) => row.kind === "regular" || row.kind === "thesis"
                  )
                  .map((row) => ({
                    value: row.date,
                    label: `${dateLabel(row.date)} ${row.presenter?.name ?? ""}`,
                  }))}
              />
            )
          }
        />
        {meetings.length === 0 ? (
          <EmptyState noun="會議" />
        ) : (
          semesters.map((semester) => (
            <section key={semester} className="flex flex-col gap-2">
              <SectionHeader title={`${semester}學期`} />
              <ul className="flex flex-col">
                {meetings
                  .filter((row) => row.semester === semester)
                  .map((meeting) => (
                    <MeetingRow
                      key={meeting.date}
                      meeting={meeting}
                      actions={actionsFor(meeting)}
                    />
                  ))}
              </ul>
            </section>
          ))
        )}
        {past.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="過去" />
            <ul className="flex flex-col">
              {past.map((meeting) => (
                <MeetingRow
                  key={meeting.date}
                  meeting={meeting}
                  actions={actionsFor(meeting)}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </PortalShell>
  )
}
