import { AvatarStack } from "@/components/avatar-stack"
import { EmptyState } from "@/components/empty-state"
import { ExpandRow } from "@/components/expand-row"
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
import { NextMeeting } from "./next-meeting"

export const dynamic = "force-dynamic"

const kindLabel = { holiday: "放假", speaker: "演講", thesis: "碩論" } as const

function When({ meeting }: { meeting: ScheduledMeeting }) {
  return (
    <span className="flex w-44 shrink-0 gap-2 whitespace-nowrap tabular-nums">
      <span>{dateLabel(meeting.date)}</span>
      <span className="text-muted-foreground">{meeting.label}</span>
    </span>
  )
}

const link = "underline-offset-4 hover:underline"

// A week in the list: quiet on its own line, opening in place for the rest.
function MeetingRow({
  meeting,
  actions,
}: {
  meeting: ScheduledMeeting
  actions?: React.ReactNode
}) {
  if (meeting.kind === "holiday")
    return (
      <li className="flex min-h-14 items-center gap-4 border-b border-border py-3 text-muted-foreground">
        <When meeting={meeting} />
        <span className="min-w-0 flex-1">{meeting.holiday ?? "放假"}</span>
        {actions}
      </li>
    )
  return (
    <ExpandRow
      actions={actions}
      summary={
        <span className="flex flex-col gap-1 sm:flex-row sm:gap-4">
          <When meeting={meeting} />
          <span className="flex min-w-0 flex-1 gap-3">
            {meeting.kind !== "regular" && (
              <span className="shrink-0 text-muted-foreground">
                {kindLabel[meeting.kind]}
              </span>
            )}
            <span
              className={
                meeting.presenter
                  ? "shrink-0 font-medium"
                  : "shrink-0 text-muted-foreground"
              }
            >
              {meeting.presenter?.name ??
                (meeting.kind === "speaker" ? "" : "未排")}
            </span>
            {meeting.title && (
              <span className="min-w-0 truncate text-muted-foreground">
                {meeting.title}
              </span>
            )}
          </span>
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-muted-foreground sm:pl-48">
        {meeting.questioners.length > 0 && (
          <AvatarStack people={meeting.questioners} />
        )}
        {meeting.paper?.url && (
          <a
            href={meeting.paper.url}
            target="_blank"
            rel="noreferrer"
            className={link}
          >
            論文
          </a>
        )}
        {meeting.slidesUrl && (
          <a
            href={meeting.slidesUrl}
            target="_blank"
            rel="noreferrer"
            className={link}
          >
            投影片
          </a>
        )}
        {meeting.recordingUrl && (
          <a
            href={meeting.recordingUrl}
            target="_blank"
            rel="noreferrer"
            className={link}
          >
            錄影
          </a>
        )}
        <span>
          {meeting.location}　{meeting.startsAt}
        </span>
        {meeting.notes && <span>{meeting.notes}</span>}
      </div>
    </ExpandRow>
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
        <NextMeeting
          meeting={meetings.find((row) => row.kind !== "holiday") ?? null}
        />
        {meetings.length === 0 ? (
          <EmptyState noun="會議" />
        ) : (
          semesters.map((semester) => (
            <section key={semester} className="flex flex-col gap-2">
              <SectionHeader title={`${semester}學期`} />
              <ul className="flex stagger-rise flex-col">
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
            <ul className="flex stagger-rise flex-col">
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
