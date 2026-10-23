// The weekly lab-meeting mails, which replaced the Apps Script mailer. On
// Thursday from 12:00 the coming Monday's presenter is reminded when the
// week still has no title; on Friday from 12:00 announce@winlab.tw gets the
// week, and a regular week also gets a Teams meeting through the rooms
// pipeline, with its calendar invite on that announcement.
import { and, asc, eq, inArray, sql } from "drizzle-orm"

import { queueMail } from "@/lib/actions/mail"
import {
  readSchedule,
  type ScheduledMeeting,
} from "@/lib/actions/meetings-shared"
import {
  bookingCalendar,
  cancelBooking,
  placeBooking,
  type Booking,
} from "@/lib/actions/rooms"
import { joinUrl } from "@/lib/actions/rooms-meetings"
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
// The recording files under this project's folder.
const RECORDING_PREFIX = "winlab"

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
type Kind = "title" | "announce"

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
 * Takes the schedule lock and claims the week's mail, both inside the
 * caller's transaction. A week moved or deleted since it was read sends
 * nothing; the change lets the mail go out again for its new state.
 */
async function claimCurrent(tx: Tx, meeting: ScheduledMeeting, kind: Kind) {
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
  await claim(tx, meeting.date, kind)
}

/** Queues a mail as the week's one mail of its kind. */
async function queueOnce(meeting: ScheduledMeeting, kind: Kind, mail: Mail) {
  await db
    .transaction(async (tx) => {
      await claimCurrent(tx, meeting, kind)
      await queueMail(tx, mail)
    })
    .catch((error) => {
      if (!(error instanceof AlreadySent)) throw error
    })
}

async function remindTitle(meeting: ScheduledMeeting) {
  if (meeting.kind === "holiday" || !meeting.presenter || meeting.title) return
  const [presenter] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, meeting.presenter.id))
  if (!presenter) return
  await queueOnce(meeting, "title", {
    to: [presenter.email],
    subject: `[Lab Meeting] 請填 ${dayLabel(meeting.date)} 的報告主題`,
    ...mailBody({
      title: "報告主題還沒填",
      rows: [
        ["時間", `${dayLabel(meeting.date)} ${meeting.startsAt}`],
        ["主講", meeting.presenter.name],
      ],
      paragraphs: ["週五中午寄出公告信前請填好，公告信會帶上主題。"],
      action: { label: "填主題", url: `${site()}/meetings` },
    }),
  })
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
async function heldBooking(meetingId: string) {
  const [held] = await db
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

async function announce(
  meeting: ScheduledMeeting,
  next: ScheduledMeeting | undefined
) {
  const held = await heldBooking(meeting.id)
  const organizer =
    meeting.kind === "holiday" || held ? null : await organizerFor(meeting)
  if (!organizer) {
    await queueOnce(meeting, "announce", announcement(meeting, next, held))
    return
  }
  // The announcement is the booking's invite, so it carries the event, and
  // the claim commits with both.
  try {
    await placeBooking({
      date: meeting.date,
      startTime: meeting.startsAt,
      endTime: addMinutes(meeting.startsAt, MEETING_MINUTES)!,
      room: null,
      place: meeting.location,
      title: composeTopic(RECORDING_PREFIX, `Lab Meeting ${meeting.date}`),
      attendees: [ANNOUNCE],
      organizer,
      online: true,
      meetingPrefix: RECORDING_PREFIX,
      groupName: null,
      agenda: null,
      issueRefs: [],
      deliverables: [],
      meetingId: meeting.id,
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
 * Inside a schedule change: the week's Teams booking, if any, and lets the
 * announcement go out again for the dates touched. The caller cancels the
 * booking with cancelLabMeeting once the change commits.
 */
export async function releaseWeek(tx: Tx, meetingId: string, dates: string[]) {
  const [held] = await tx
    .select()
    .from(roomBookings)
    .where(
      and(
        eq(roomBookings.meetingId, meetingId),
        eq(roomBookings.status, "booked")
      )
    )
  await tx
    .delete(meetingMailRuns)
    .where(
      and(
        inArray(meetingMailRuns.date, dates),
        eq(meetingMailRuns.kind, "announce")
      )
    )
  return held ?? null
}

/** Takes down a released week's Teams meeting, mailing the lab. */
export async function cancelLabMeeting(held: Booking | null, actorId: string) {
  if (held) await cancelBooking(held, actorId)
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
  // Thursday noon to Friday noon: the title reminder. Friday noon until the
  // meeting starts on Monday: the announcement, so a server that was down
  // still sends it.
  const kind: Kind | null =
    (weekday === 4 && minutes >= noon) || (weekday === 5 && minutes < noon)
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
  if (kind === "title") await remindTitle(meeting)
  else
    await announce(
      meeting,
      schedule.find((m) => m.date === addDays(monday, 7))
    )
}

/** Checks every 10 minutes; called once per server process. */
export function startMeetingMailScheduler() {
  const tick = () =>
    void runMeetingMail().catch((error) => emitErrorLog(error, {}))
  setInterval(tick, 10 * 60_000).unref()
  tick()
}
