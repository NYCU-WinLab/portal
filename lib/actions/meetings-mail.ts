// The weekly lab-meeting mails, which replaced the Apps Script mailer. On
// Thursday from 12:00 the coming Monday's presenter is reminded when the
// week still has no title; on Friday from 12:00 announce@winlab.tw gets the
// week, and a regular week also gets a Teams meeting through the rooms
// pipeline, with its calendar invite on that announcement.
import { and, asc, eq } from "drizzle-orm"

import { queueMail } from "@/lib/actions/mail"
import {
  readSchedule,
  type ScheduledMeeting,
} from "@/lib/actions/meetings-shared"
import {
  bookingCalendar,
  placeBooking,
  type Booking,
} from "@/lib/actions/rooms"
import { joinUrl } from "@/lib/actions/rooms-meetings"
import { db } from "@/lib/db"
import { admins, meetingMailRuns, roomBookings, user } from "@/lib/db/schema"
import { mailBody } from "@/lib/mail-body"
import { emitErrorLog } from "@/lib/otel"
import { composeTopic } from "@/lib/rooms/meeting"
import { addDays, addMinutes, dayLabel, weekdayOf } from "@/lib/rooms/time"

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

/** Claims one weekly mail for a Monday; false when it went out already. */
async function claim(date: string, kind: "title" | "announce") {
  const rows = await db
    .insert(meetingMailRuns)
    .values({ date, kind })
    .onConflictDoNothing()
    .returning()
  return rows.length > 0
}

async function remindTitle(meeting: ScheduledMeeting) {
  if (meeting.kind === "holiday" || !meeting.presenter || meeting.title) return
  const [presenter] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, meeting.presenter.id))
  if (!presenter) return
  await queueMail(db, {
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

async function announce(
  meeting: ScheduledMeeting,
  next: ScheduledMeeting | undefined
) {
  const [held] = await db
    .select()
    .from(roomBookings)
    .where(
      and(
        eq(roomBookings.meetingId, meeting.id),
        eq(roomBookings.status, "booked")
      )
    )
  const organizer =
    meeting.kind === "holiday" || held ? null : await organizerFor(meeting)
  if (!organizer) {
    await queueMail(db, announcement(meeting, next, held ?? null))
    return
  }
  // The announcement is the booking's invite, so it carries the event. When
  // the booking fails the lab still gets the announcement, without Teams.
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
    invite: (booking) => ({
      ...announcement(meeting, next, booking),
      replyTo: organizer.email,
      ...bookingCalendar(booking, organizer, "REQUEST"),
    }),
  }).catch(async (error) => {
    emitErrorLog(error, { "meeting.date": meeting.date })
    await queueMail(db, announcement(meeting, next, null))
  })
}

/** Sends the week's mails that are due; safe to call any number of times. */
export async function runMeetingMail(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
  }).format(now)
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      hour12: false,
    }).format(now)
  )
  const weekday = weekdayOf(today)
  // Thursday noon to Friday noon: the title reminder. Friday noon to the
  // meeting itself: the announcement, so a server that was down still sends.
  const kind =
    (weekday === 4 && hour >= 12) || (weekday === 5 && hour < 12)
      ? "title"
      : (weekday === 5 && hour >= 12) || weekday === 6 || weekday === 0
        ? "announce"
        : null
  if (!kind) return
  const monday = addDays(today, (8 - weekday) % 7)
  const schedule = await readSchedule({ fromDate: addDays(monday, -1) })
  const meeting = schedule.find((m) => m.date === monday)
  if (!meeting || !(await claim(monday, kind))) return
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
