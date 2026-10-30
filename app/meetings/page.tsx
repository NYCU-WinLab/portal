import { ChevronDownIcon } from "lucide-react"

import { AvatarStack, type StackPerson } from "@/components/avatar-stack"
import { EmptyState } from "@/components/empty-state"
import { ExpandRow } from "@/components/expand-row"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listMembers } from "@/lib/actions/admins"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listLabMeetings } from "@/lib/actions/meetings"
import type { ScheduledMeeting } from "@/lib/actions/meetings-shared"
import { listPapers } from "@/lib/actions/papers"
import { listMeetings, listProjectGroups } from "@/lib/actions/rooms"
import { listStandingMeetings } from "@/lib/actions/rooms-series"
import { requireActor } from "@/lib/auth/session"
import { dateLabel, taipeiToday } from "@/lib/leave-dates"
import { DEFAULT_TOPIC, splitTopic } from "@/lib/rooms/meeting"
import { addDays, addMinutes, occurrencesBetween } from "@/lib/rooms/time"

import { AdminActions } from "./admin-actions"
import { CancelButton } from "./cancel-button"
import { MeetingActions } from "./meeting-actions"
import { meetingsNav, meetingsPage } from "./nav"
import { NewMeeting } from "./new-meeting"
import { NextMeeting } from "./next-meeting"
import { SeriesButtons } from "./series-buttons"

export const dynamic = "force-dynamic"

const kindLabel = { holiday: "放假", speaker: "演講", thesis: "碩論" } as const
const weekdays = "日一二三四五六"
// How far ahead the list shows other meetings; lab weeks run all term.
const BOOKING_DAYS = 60

type Booking = Awaited<ReturnType<typeof listMeetings.run>>["bookings"][number]
type Series = Awaited<
  ReturnType<typeof listStandingMeetings.run>
>["series"][number]

// The date, then the week for a lab meeting or the time for any other.
function When({ date, aside }: { date: string; aside: React.ReactNode }) {
  return (
    <span className="flex shrink-0 whitespace-nowrap tabular-nums">
      <span className="w-14">{dateLabel(date)}</span>
      <span className="w-20 text-muted-foreground">{aside}</span>
    </span>
  )
}

const teamsText = (booking: Booking) => {
  if (!booking.meeting) return null
  if (booking.meeting.status === "success") return null
  if (booking.meeting.status === "pending") return "線上會議建立中"
  return `線上會議沒有建成：${booking.meeting.error ?? "原因不明"}`
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
        <When date={meeting.date} aside={meeting.label} />
        <span className="min-w-0 flex-1">{meeting.holiday ?? "放假"}</span>
        {actions}
      </li>
    )
  return (
    <ExpandRow
      actions={actions}
      summary={
        <span className="flex flex-col gap-1 sm:flex-row sm:gap-4">
          <When date={meeting.date} aside={meeting.label} />
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
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-muted-foreground sm:pl-38">
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
        {meeting.joinUrl && (
          <a
            href={meeting.joinUrl}
            target="_blank"
            rel="noreferrer"
            className={link}
          >
            加入會議
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

// Any other meeting: who called it, who comes, and its Teams link.
// "[cairn]-sync" as members read it: the project's or the person's name,
// then the title, which is left out when it is only the default "meeting".
function Topic({ topic, owners }: { topic: string; owners: Owners }) {
  const { prefix, title } = splitTopic(topic)
  const owner = prefix ? (owners.get(prefix) ?? prefix) : null
  if (!owner) return <span className="min-w-0 truncate">{title}</span>
  return (
    <span className="flex min-w-0 gap-3">
      <span
        className={
          title === DEFAULT_TOPIC
            ? "shrink-0"
            : "shrink-0 text-muted-foreground"
        }
      >
        {owner}
      </span>
      {title !== DEFAULT_TOPIC && (
        <span className="min-w-0 truncate">{title}</span>
      )}
    </span>
  )
}

type Owners = Map<string, string>
// Attendees by email, as portal members: Keycloak groups send English
// name order ("秉育 何"), the portal has 何秉育.
type People = Map<string, StackPerson>

const crowd = (attendees: { name: string; email: string }[], people: People) =>
  attendees.map(
    (a) => people.get(a.email.toLowerCase()) ?? { id: a.email, name: a.name }
  )

/** Topic as plain text, for confirm dialogs. */
function topicText(topic: string, owners: Owners) {
  const { prefix, title } = splitTopic(topic)
  const owner = prefix ? (owners.get(prefix) ?? prefix) : null
  if (!owner) return title
  return title === DEFAULT_TOPIC ? owner : `${owner} ${title}`
}

function BookingRow({
  booking,
  owners,
  people,
  actions,
}: {
  booking: Booking
  owners: Owners
  people: People
  actions?: React.ReactNode
}) {
  return (
    <ExpandRow
      actions={actions}
      summary={
        <span className="flex flex-col gap-1 sm:flex-row sm:gap-4">
          <When date={booking.date} aside={booking.startTime} />
          <span className="flex min-w-0 flex-1 gap-3">
            <Topic topic={booking.title} owners={owners} />
            <span className="ml-auto shrink-0 text-muted-foreground">
              {booking.room ?? "線上"}
            </span>
          </span>
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-muted-foreground sm:pl-38">
        {booking.meeting?.status === "success" && (
          <a href={`/rooms/join/${booking.id}`} className={link}>
            加入會議
          </a>
        )}
        <span>
          {booking.startTime} 到 {booking.endTime}
        </span>
        <span>發起人 {booking.requestedByName}</span>
        {booking.attendees.length > 0 && (
          <AvatarStack people={crowd(booking.attendees, people)} />
        )}
        {booking.seriesId && <span>固定會議</span>}
        {teamsText(booking) && <span>{teamsText(booking)}</span>}
        {booking.agenda && (
          <span className="w-full whitespace-pre-wrap">{booking.agenda}</span>
        )}
      </div>
    </ExpandRow>
  )
}

function SeriesRow({
  series,
  owners,
  people,
  actions,
}: {
  series: Series
  owners: Owners
  people: People
  actions?: React.ReactNode
}) {
  return (
    <ExpandRow
      actions={actions}
      summary={
        <span className="flex flex-col gap-1 sm:flex-row sm:gap-4">
          <span className="w-38 shrink-0 whitespace-nowrap tabular-nums">
            {series.intervalWeeks === 2 ? "隔週" : "每週"}
            {weekdays[series.weekday]} {series.startTime}
          </span>
          <span className="flex min-w-0 flex-1 gap-3">
            <Topic topic={series.title} owners={owners} />
            {!series.active && (
              <span className="ml-auto shrink-0 text-muted-foreground">
                暫停
              </span>
            )}
          </span>
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-muted-foreground sm:pl-38">
        <span>
          {series.startTime} 到{" "}
          {addMinutes(series.startTime, series.durationMinutes)}
        </span>
        <span>建立者 {series.createdByName}</span>
        {series.attendees.length > 0 && (
          <AvatarStack people={crowd(series.attendees, people)} />
        )}
        {series.includeAdvisor && <span>邀請老師</span>}
        {series.agenda && (
          <span className="w-full whitespace-pre-wrap">{series.agenda}</span>
        )}
      </div>
    </ExpandRow>
  )
}

// A standing meeting's week that is not booked yet: quiet, no room.
function StandingRow({
  series,
  date,
  owners,
  people,
}: {
  series: Series
  date: string
  owners: Owners
  people: People
}) {
  return (
    <ExpandRow
      summary={
        <span className="flex flex-col gap-1 text-muted-foreground sm:flex-row sm:gap-4">
          <When date={date} aside={series.startTime} />
          <span className="flex min-w-0 flex-1 gap-3">
            <Topic topic={series.title} owners={owners} />
            <span className="ml-auto shrink-0">未訂</span>
          </span>
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-muted-foreground sm:pl-38">
        <span>
          {series.startTime} 到{" "}
          {addMinutes(series.startTime, series.durationMinutes)}
        </span>
        <span>建立者 {series.createdByName}</span>
        {series.attendees.length > 0 && (
          <AvatarStack people={crowd(series.attendees, people)} />
        )}
      </div>
    </ExpandRow>
  )
}

type Entry =
  | { at: string; lab: ScheduledMeeting }
  | { at: string; booking: Booking }
  | { at: string; standing: Series; date: string }

const monthOf = (date: string) => `${Number(date.slice(5, 7))} 月`

export default async function MeetingsPage() {
  const actor = await requireActor("/meetings")
  const today = taipeiToday()
  const [
    { meetings },
    { meetings: past },
    { papers },
    admin,
    { bookings },
    { series },
    groups,
    members,
  ] = await Promise.all([
    runAction(listLabMeetings, actor, {}),
    runAction(listLabMeetings, actor, { past: true }),
    runAction(listPapers, actor, {}),
    isAdmin(actor, "meetings"),
    runAction(listMeetings, actor, { date: today, days: BOOKING_DAYS }),
    runAction(listStandingMeetings, actor, {}),
    // Keycloak being down leaves booking without groups, not broken.
    runAction(listProjectGroups, actor, {}).then(
      ({ groups }) => groups,
      () => []
    ),
    runAction(listMembers, actor, {}),
  ])
  const paperOptions = papers.map((paper) => ({
    value: paper.id,
    label: paper.venue ? `${paper.title}（${paper.venue}）` : paper.title,
  }))
  // Who a [prefix] stands for: a project group's label, else a member's name.
  const owners: Owners = new Map([
    ...members.flatMap((m) =>
      m.username ? [[m.username, m.name] as [string, string]] : []
    ),
    ...groups.map((g) => [g.name, g.label] as [string, string]),
  ])
  const people: People = new Map(
    members.map((m) => [m.email.toLowerCase(), { id: m.id, name: m.name }])
  )
  // Lab weeks carry their own Teams meeting, so their bookings are left out.
  const horizon = addDays(today, BOOKING_DAYS - 1)
  // A standing meeting's later weeks, booked 7 days ahead, are on the list
  // before they are booked. A day that has a booking, kept or cancelled,
  // shows that instead.
  const held = new Set(
    bookings.flatMap((b) => (b.seriesId ? [`${b.seriesId} ${b.date}`] : []))
  )
  const upcoming = series
    .filter((s) => s.active)
    .flatMap((s) =>
      occurrencesBetween(s, today, horizon)
        .filter((date) => !held.has(`${s.id} ${date}`))
        .map((date) => ({ at: `${date} ${s.startTime}`, standing: s, date }))
    )
  const timeline: Entry[] = [
    ...upcoming,
    ...meetings.map((lab) => ({ at: `${lab.date} ${lab.startsAt}`, lab })),
    ...bookings
      .filter((b) => b.status === "booked" && !b.labMeetingId)
      .map((booking) => ({
        at: `${booking.date} ${booking.startTime}`,
        booking,
      })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  const months = [
    ...new Set(
      timeline
        .filter((entry) => entry.at.slice(0, 10) <= horizon)
        .map((entry) => monthOf(entry.at))
    ),
  ]
  const later = timeline.filter((entry) => entry.at.slice(0, 10) > horizon)

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

  const renderEntry = (entry: Entry) =>
    "standing" in entry ? (
      <StandingRow
        key={`${entry.standing.id}-${entry.date}`}
        series={entry.standing}
        date={entry.date}
        owners={owners}
        people={people}
      />
    ) : "lab" in entry ? (
      <MeetingRow
        key={`lab-${entry.lab.date}`}
        meeting={entry.lab}
        actions={actionsFor(entry.lab)}
      />
    ) : (
      <BookingRow
        owners={owners}
        people={people}
        key={entry.booking.id}
        booking={entry.booking}
        actions={
          entry.booking.requestedBy === actor.userId && (
            <CancelButton
              id={entry.booking.id}
              title={topicText(entry.booking.title, owners)}
            />
          )
        }
      />
    )

  return (
    <PortalShell page={meetingsPage} nav={meetingsNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="會議"
          actions={
            <>
              <NewMeeting
                today={today}
                groups={groups}
                members={members}
                username={
                  members.find((m) => m.id === actor.userId)?.username ?? null
                }
              />
              {admin && (
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
              )}
            </>
          }
        />
        <NextMeeting
          meeting={meetings.find((row) => row.kind !== "holiday") ?? null}
        />
        {timeline.length === 0 ? (
          <EmptyState noun="會議" />
        ) : (
          <>
            {months.map((month) => (
              <section key={month} className="flex flex-col gap-2">
                <SectionHeader title={month} />
                <ul className="flex stagger-rise flex-col">
                  {timeline
                    .filter(
                      (entry) =>
                        entry.at.slice(0, 10) <= horizon &&
                        monthOf(entry.at) === month
                    )
                    .map(renderEntry)}
                </ul>
              </section>
            ))}
            {later.length > 0 && (
              <section className="flex flex-col gap-2">
                <SectionHeader title="之後的實驗室會議" />
                <ul className="flex stagger-rise flex-col">
                  {later.map(renderEntry)}
                </ul>
              </section>
            )}
          </>
        )}
        {series.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="固定會議" />
            <ul className="flex stagger-rise flex-col">
              {series.map((s) => (
                <SeriesRow
                  owners={owners}
                  people={people}
                  key={s.id}
                  series={s}
                  actions={
                    s.createdBy === actor.userId && (
                      <SeriesButtons
                        id={s.id}
                        title={topicText(s.title, owners)}
                        active={s.active}
                      />
                    )
                  }
                />
              ))}
            </ul>
          </section>
        )}
        {past.length > 0 && (
          <details className="group flex flex-col gap-2">
            <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
              過去的實驗室會議
              <span className="font-normal text-muted-foreground tabular-nums">
                {past.length}
              </span>
              <ChevronDownIcon className="size-4 text-muted-foreground transition-transform duration-state group-open:rotate-180" />
            </summary>
            <ul className="mt-2 flex flex-col">
              {past.map((meeting) => (
                <MeetingRow
                  key={meeting.date}
                  meeting={meeting}
                  actions={actionsFor(meeting)}
                />
              ))}
            </ul>
          </details>
        )}
      </div>
    </PortalShell>
  )
}
