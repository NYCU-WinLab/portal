// The weekly lab-meeting mails, which replaced the Apps Script mailer. From
// Tuesday the coming Monday's presenter is reminded every morning at 9:00
// while the week has no title, and the week gets its Teams meeting through
// the rooms pipeline as soon as the title is in. On Friday from 12:00
// announce@winlab.tw gets the week, with the Teams meeting's calendar invite
// (made then when the title never came). A later change of paper or
// presenter renames that Teams meeting, keeping its link.
import { and, asc, eq, inArray, sql } from "drizzle-orm"

import { queueMail } from "@/lib/actions/mail"
import {
  readSchedule,
  type ScheduledMeeting,
} from "@/lib/actions/meetings-shared"
import {
  bookingCalendar,
  cancelBooking,
  organizerOf,
  placeBooking,
  type Booking,
} from "@/lib/actions/rooms"
import { joinUrl, renameTeamsMeeting } from "@/lib/actions/rooms-meetings"
import { db } from "@/lib/db"
import {
  admins,
  meetingMailRuns,
  meetings,
  roomBookings,
  user,
} from "@/lib/db/schema"
import type { Mail } from "@/lib/mail"
import { mailBody } from "@/lib/mail-body"
import { emitErrorLog } from "@/lib/otel"
import { composeTopic } from "@/lib/rooms/meeting"
import {
  addDays,
  addMinutes,
  dayLabel,
  minutesOf,
  weekdayOf,
} from "@/lib/rooms/time"

const ANNOUNCE = { name: "WinLab", email: "announce@winlab.tw" }
// 15:30 to 18:00, as the old calendar event ran.
const MEETING_MINUTES = 150
// The lab-meeting GitLab group. winlab-helper files a `[lab-meeting]-`
// recording into its Recordings folder, and keeps the meeting's epic there
// only when the booking names the group: without one it reads the prefix as
// a person and opens a personal folder and epic for "lab-meeting".
const LAB_GROUP = "lab-meeting"

// The daily title reminder goes out from 9:00 Taipei time.
const REMIND_AT = 9 * 60

const site = () => process.env.BETTER_AUTH_URL ?? "https://portal.winlab.tw"
const kindLabel = { speaker: "演講", thesis: "碩論" } as const

/** "10/26（一） 主講：宋承叡", or the week's kind when nobody presents. */
function headline(meeting: ScheduledMeeting) {
  const day = dayLabel(meeting.date)
  if (meeting.kind === "holiday")
    return `${day} 休會${meeting.holiday ? `（${meeting.holiday}）` : ""}`
  if (meeting.presenter) return `${day} 主講：${meeting.presenter.name}`
  return meeting.kind === "regular"
    ? `${day} Lab Meeting`
    : `${day} ${kindLabel[meeting.kind]}`
}

// Room for the rest of a recording's file name.
const TOPIC_TITLE_MAX = 100

/**
 * "宋承叡 <paper title>": winlab-helper files the recording as
 * "[lab-meeting] 2026-10-26 宋承叡 <paper title>.mp4", adding the date itself,
 * and the file-index issue takes that name.
 */
function recordingTopic(meeting: ScheduledMeeting) {
  const title = meeting.title?.trim()
  const what = [
    meeting.presenter?.name,
    title && title.length > TOPIC_TITLE_MAX
      ? `${title.slice(0, TOPIC_TITLE_MAX).trimEnd()}…`
      : title,
  ].filter(Boolean)
  return what.length ? what.join(" ") : "Lab Meeting"
}

/**
 * What the week is, for the GitLab record winlab-helper opens from the
 * booking: it writes AGENDA under "Agenda", the presenter and paper its
 * own lab skeleton leaves for a person to fill in.
 */
function recordAgenda(meeting: ScheduledMeeting) {
  const paper = meeting.paper
  const lines = [
    meeting.presenter && `- 主講：${meeting.presenter.name}`,
    paper
      ? `- 論文：${paper.url ? `[${paper.title}](${paper.url})` : paper.title}${
          paper.venue ? `（${paper.venue}）` : ""
        }`
      : meeting.title && `- 題目：${meeting.title}`,
    meeting.slidesUrl && `- 投影片：${meeting.slidesUrl}`,
    meeting.questioners.length > 0 &&
      `- 提問：${meeting.questioners.map((q) => q.name).join("、")}`,
  ].filter(Boolean)
  return lines.length ? lines.join("\n") : null
}

function nextWeekRow(next: ScheduledMeeting | undefined): [string, string][] {
  if (!next) return []
  if (next.kind === "holiday")
    return [["下週", `休會${next.holiday ? `（${next.holiday}）` : ""}`]]
  return next.presenter ? [["下週主講", next.presenter.name]] : []
}

function announcement(
  meeting: ScheduledMeeting,
  next: ScheduledMeeting | undefined,
  booking: Booking | null
) {
  const holiday = meeting.kind === "holiday"
  const end = addMinutes(meeting.startsAt, MEETING_MINUTES)
  return {
    to: [ANNOUNCE.email],
    subject: `[Lab Meeting] ${headline(meeting)}`,
    ...mailBody({
      title: headline(meeting),
      rows: holiday
        ? nextWeekRow(next)
        : [
            ["時間", `${dayLabel(meeting.date)} ${meeting.startsAt} 到 ${end}`],
            ["地點", meeting.location],
            ...(meeting.presenter
              ? [["主講", meeting.presenter.name] as [string, string]]
              : []),
            ["主題", meeting.title ?? "待定"],
            ...(meeting.questioners.length
              ? [
                  [
                    "提問",
                    meeting.questioners.map((q) => q.name).join("、"),
                  ] as [string, string],
                ]
              : []),
            ...nextWeekRow(next),
          ],
      paragraphs: holiday
        ? []
        : [`請假：${site()}/leave\n訂便當：${site()}/bento`],
      action: booking
        ? { label: "加入會議", url: joinUrl(booking.id) }
        : undefined,
    }),
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
// One reminder a day, keyed by the day it goes out; one announcement.
type Kind = `title:${string}` | "announce"

/** Thrown inside a transaction when its weekly mail went out already. */
class AlreadySent extends Error {}

/**
 * Claims one weekly mail for a Monday inside the transaction that queues
 * it, so a crash between the two leaves neither and the next tick retries.
 */
async function claim(tx: Tx, date: string, kind: Kind) {
  const rows = await tx
    .insert(meetingMailRuns)
    .values({ date, kind })
    .onConflictDoNothing()
    .returning()
  if (!rows.length) throw new AlreadySent()
}

/**
 * Takes the schedule lock inside the caller's transaction. A week moved or
 * deleted since it was read gets nothing; the change lets its mail and
 * Teams meeting go out again for its new state.
 */
async function lockCurrent(tx: Tx, meeting: ScheduledMeeting) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('meetings'))`)
  const [now] = await tx
    .select({
      startsAt: meetings.startsAt,
      location: meetings.location,
      kind: meetings.kind,
    })
    .from(meetings)
    .where(and(eq(meetings.id, meeting.id), eq(meetings.date, meeting.date)))
  if (
    !now ||
    now.startsAt.slice(0, 5) !== meeting.startsAt ||
    now.location !== meeting.location ||
    now.kind !== meeting.kind
  )
    throw new AlreadySent()
}

/** Takes the schedule lock and claims the week's mail. */
async function claimCurrent(tx: Tx, meeting: ScheduledMeeting, kind: Kind) {
  await lockCurrent(tx, meeting)
  await claim(tx, meeting.date, kind)
}

/** Queues a mail as the week's one mail of its kind. */
async function queueOnce(
  meeting: ScheduledMeeting,
  kind: Kind,
  mail: Mail,
  /** Runs under the lock; throwing AlreadySent sends nothing this tick. */
  stillDue?: (tx: Tx) => Promise<void>
) {
  await db
    .transaction(async (tx) => {
      await claimCurrent(tx, meeting, kind)
      await stillDue?.(tx)
      await queueMail(tx, mail)
    })
    .catch((error) => {
      if (!(error instanceof AlreadySent)) throw error
    })
}

async function remindTitle(meeting: ScheduledMeeting, today: string) {
  if (meeting.kind === "holiday" || !meeting.presenter || meeting.title) return
  const [presenter] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, meeting.presenter.id))
  if (!presenter) return
  const untitled = async (tx: Tx) => {
    // The presenter may have saved a title since the schedule was read.
    const [now] = await tx
      .select({ title: meetings.title, paperId: meetings.paperId })
      .from(meetings)
      .where(eq(meetings.id, meeting.id))
    if (now?.title || now?.paperId) throw new AlreadySent()
  }
  await queueOnce(
    meeting,
    `title:${today}`,
    {
      to: [presenter.email],
      subject: `[Lab Meeting] 請填 ${dayLabel(meeting.date)} 的報告主題`,
      ...mailBody({
        title: "報告主題還沒填",
        rows: [
          ["時間", `${dayLabel(meeting.date)} ${meeting.startsAt}`],
          ["主講", meeting.presenter.name],
        ],
        paragraphs: [
          "填好後會建立 Teams 會議，週五中午的公告信會帶上主題。還沒填的話，每天早上 9 點會再提醒。",
        ],
        action: { label: "填主題", url: `${site()}/meetings` },
      }),
    },
    untitled
  )
}

/** Who sends the invite: the presenter, else a portal admin. */
async function organizerFor(meeting: ScheduledMeeting) {
  const [row] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .leftJoin(admins, and(eq(admins.userId, user.id), eq(admins.app, "portal")))
    .where(
      meeting.presenter
        ? eq(user.id, meeting.presenter.id)
        : eq(admins.app, "portal")
    )
    .orderBy(asc(user.name))
    .limit(1)
  return row ?? null
}

/** The week's Teams booking, if it holds one. */
async function heldBooking(meetingId: string, tx: Tx | typeof db = db) {
  const [held] = await tx
    .select()
    .from(roomBookings)
    .where(
      and(
        eq(roomBookings.meetingId, meetingId),
        eq(roomBookings.status, "booked")
      )
    )
  return held ?? null
}

/** The week's Teams booking, its invite left to the caller. */
function labBooking(
  meeting: ScheduledMeeting,
  organizer: { id: string; name: string; email: string }
) {
  return {
    date: meeting.date,
    startTime: meeting.startsAt,
    endTime: addMinutes(meeting.startsAt, MEETING_MINUTES)!,
    room: null,
    place: meeting.location,
    title: composeTopic(LAB_GROUP, recordingTopic(meeting)),
    attendees: [ANNOUNCE],
    organizer,
    online: true,
    meetingPrefix: LAB_GROUP,
    groupName: LAB_GROUP,
    agenda: recordAgenda(meeting),
    issueRefs: [],
    deliverables: [],
    meetingId: meeting.id,
  }
}

/**
 * Makes the week's Teams meeting once its title is in, so the recording
 * and the GitLab record carry it. Nothing is mailed: the Friday
 * announcement is the invite.
 */
async function bookEarly(meeting: ScheduledMeeting) {
  if (meeting.kind === "holiday" || !meeting.title) return
  if (await heldBooking(meeting.id)) return
  const organizer = await organizerFor(meeting)
  if (!organizer) return
  try {
    await placeBooking({
      ...labBooking(meeting, organizer),
      inTransaction: async (tx) => {
        await lockCurrent(tx, meeting)
        if (await heldBooking(meeting.id, tx)) throw new AlreadySent()
      },
      invite: () => null,
    })
  } catch (error) {
    if (error instanceof AlreadySent) return
    // Committed, only asking GitLab failed: the pipeline sweep mails the
    // organizer. Not committed: the next tick tries again.
    emitErrorLog(error, { "meeting.date": meeting.date })
  }
}

async function announce(
  meeting: ScheduledMeeting,
  next: ScheduledMeeting | undefined
) {
  const held = await heldBooking(meeting.id)
  if (held) {
    // Made earlier without mail, so the announcement carries its invite.
    const organizer = await organizerOf(held.requestedBy)
    await queueOnce(
      meeting,
      "announce",
      {
        ...announcement(meeting, next, held),
        replyTo: organizer.email,
        ...bookingCalendar(held, organizer, "REQUEST"),
      },
      async (tx) => {
        // A schedule change commits before it cancels the old booking: wait
        // for that, then the next tick books the new slot.
        const now = await heldBooking(meeting.id, tx)
        if (
          now?.id !== held.id ||
          meeting.kind === "holiday" ||
          now.date !== meeting.date ||
          now.startTime.slice(0, 5) !== meeting.startsAt ||
          now.place !== meeting.location
        )
          throw new AlreadySent()
      }
    )
    return
  }
  const organizer =
    meeting.kind === "holiday" ? null : await organizerFor(meeting)
  if (!organizer) {
    await queueOnce(meeting, "announce", announcement(meeting, next, null))
    return
  }
  // The announcement is the booking's invite, so it carries the event, and
  // the claim commits with both.
  try {
    await placeBooking({
      ...labBooking(meeting, organizer),
      inTransaction: (tx) => claimCurrent(tx, meeting, "announce"),
      invite: (booking) => ({
        ...announcement(meeting, next, booking),
        replyTo: organizer.email,
        ...bookingCalendar(booking, organizer, "REQUEST"),
      }),
    })
  } catch (error) {
    if (error instanceof AlreadySent) return
    emitErrorLog(error, { "meeting.date": meeting.date })
    // Committed, so the announcement is queued: only asking GitLab for the
    // Teams meeting failed, and the pipeline sweep mails the organizer.
    if (await heldBooking(meeting.id)) return
    // Nothing committed: the lab still gets the week, without Teams.
    await queueOnce(meeting, "announce", announcement(meeting, next, null))
  }
}

/**
 * Keeps the week's Teams meeting named after what is presented: a new
 * paper, presenter or questioners update the booking, and a new title also
 * renames its Teams meeting and GitLab record through an update that keeps
 * the link. A time or place change is not this: it releases the week.
 */
async function syncTeamsTopic(meeting: ScheduledMeeting) {
  if (meeting.kind === "holiday") return
  const held = await heldBooking(meeting.id)
  if (!held) return
  const title = composeTopic(LAB_GROUP, recordingTopic(meeting))
  const agenda = recordAgenda(meeting)
  if (held.title !== title || held.agenda !== agenda) {
    const [renamed] = await db
      .transaction(async (tx) => {
        await lockCurrent(tx, meeting)
        return tx
          .update(roomBookings)
          .set({ title, agenda })
          .where(
            and(eq(roomBookings.id, held.id), eq(roomBookings.status, "booked"))
          )
          .returning()
      })
      .catch((error) => {
        if (error instanceof AlreadySent) return []
        throw error
      })
    if (!renamed) return
  }
  await renameTeamsMeeting(held.id)
}

/** A Teams booking a schedule change let go, and whether the lab heard of it. */
type Released = { booking: Booking; announced: boolean }

/**
 * Inside a schedule change: the week's Teams booking, if any, and lets the
 * announcement go out again for the dates touched. The caller cancels the
 * booking with cancelLabMeeting once the change commits.
 */
export async function releaseWeek(
  tx: Tx,
  meetingId: string,
  dates: string[]
): Promise<Released | null> {
  const held = await heldBooking(meetingId, tx)
  const sent = await tx
    .delete(meetingMailRuns)
    .where(
      and(
        inArray(meetingMailRuns.date, dates),
        eq(meetingMailRuns.kind, "announce")
      )
    )
    .returning()
  // dates[0] is the week's own date before the change.
  const announced = sent.some((run) => run.date === dates[0])
  return held ? { booking: held, announced } : null
}

/**
 * Takes down a released week's Teams meeting, mailing the lab the
 * cancellation only when the announcement had invited it.
 */
export async function cancelLabMeeting(
  released: Released | null,
  actorId: string
) {
  if (released)
    await cancelBooking(released.booking, actorId, {
      notify: released.announced,
    })
}

const minutesNow = (now: Date) => {
  const [hour, minute] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(now)
    .split(":")
    .map(Number)
  return (hour % 24) * 60 + minute
}

/** Sends the week's mails that are due; safe to call any number of times. */
export async function runMeetingMail(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
  }).format(now)
  const minutes = minutesNow(now)
  const noon = 12 * 60
  const weekday = weekdayOf(today)
  // Tuesday to Friday noon: a reminder each day from 9:00 while the title
  // is missing, and the Teams meeting once it is in. Friday noon until the
  // meeting starts on Monday: the announcement, so a server that was down
  // still sends it.
  const kind =
    (weekday >= 2 && weekday <= 4) || (weekday === 5 && minutes < noon)
      ? "title"
      : (weekday === 5 && minutes >= noon) ||
          weekday === 6 ||
          weekday === 0 ||
          weekday === 1
        ? "announce"
        : null
  if (!kind) return
  const monday = weekday === 1 ? today : addDays(today, (8 - weekday) % 7)
  const schedule = await readSchedule({ fromDate: addDays(monday, -1) })
  const meeting = schedule.find((m) => m.date === monday)
  if (!meeting) return
  if (weekday === 1 && minutes >= (minutesOf(meeting.startsAt) ?? 0)) return
  if (kind === "title") {
    if (minutes >= REMIND_AT) await remindTitle(meeting, today)
    await bookEarly(meeting)
  } else
    await announce(
      meeting,
      schedule.find((m) => m.date === addDays(monday, 7))
    )
  await syncTeamsTopic(meeting)
}

/** Checks every 10 minutes; called once per server process. */
export function startMeetingMailScheduler() {
  const tick = () =>
    void runMeetingMail().catch((error) => emitErrorLog(error, {}))
  setInterval(tick, 10 * 60_000).unref()
  tick()
}
