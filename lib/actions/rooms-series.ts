// Standing meetings. Each occurrence is booked a week ahead, not for the
// whole term: rooms are first come, first served, and booking one week at a
// time picks whatever is free by then. An online-only series takes no room
// and books the same way, so every week still gets its own invite. A daily run in the server process
// does it; a new series books its first week at once, which the daily run
// (looking only 7 days out) would never reach.
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte } from "drizzle-orm"
import { z } from "zod"

import { announceChange } from "@/lib/actions/changes"
import { defineAction } from "@/lib/actions/define"
import { queueMail } from "@/lib/actions/mail"
import {
  availability,
  organizerOf,
  placeBooking,
  resolveAttendees,
  roomFor,
  seriesBookings,
  withBookingLock,
} from "@/lib/actions/rooms"
import {
  reconcileTeams,
  sweepMeetingRequests,
} from "@/lib/actions/rooms-meetings"
import { mailBody } from "@/lib/mail-body"
import { db } from "@/lib/db"
import {
  account,
  roomBookings,
  roomDailyRuns,
  roomSeries,
  user,
} from "@/lib/db/schema"
import { epicIssues, getEpic } from "@/lib/gitlab"
import { inProjectGroup, projectGroups } from "@/lib/keycloak"
import { bookingConfigured } from "@/lib/meetingroom"
import type { Slot } from "@/lib/rooms/availability"
import {
  ADVISOR_USERNAME,
  DEFAULT_TOPIC,
  cleanTopic,
  deliverablesOf,
  epicIid,
  externalMeetingUrl,
  mergeAttendees,
  plainTitle,
  topicPrefix,
} from "@/lib/rooms/meeting"
import { emitErrorLog } from "@/lib/otel"
import {
  SERIES_MAX_MINUTES,
  SERIES_MIN_MINUTES,
  addDays,
  addMinutes,
  dayLabel,
  endAfter,
  isCalendarDay,
  nextOccurrence,
  nextWeekday,
  occurrencesBetween,
  onlineSpanProblem,
  spanProblem,
  spansOverlap,
  todayInTaipei,
  weekdayOf,
} from "@/lib/rooms/time"

const LEAD_DAYS = 7

type Series = typeof roomSeries.$inferSelect

/** An online-only series may end at midnight, "24:00". */
const seriesEnd = (
  series: Pick<Series, "startTime" | "durationMinutes" | "onlineOnly">
) =>
  series.onlineOnly
    ? endAfter(series.startTime, series.durationMinutes)
    : addMinutes(series.startTime, series.durationMinutes)

const rule = (series: Series) => ({
  weekday: series.weekday,
  intervalWeeks: series.intervalWeeks,
  anchorDate: series.anchorDate,
})

export const listStandingMeetings = defineAction({
  name: "list_standing_meetings",
  title: "固定會議",
  description:
    "Every standing meeting on /meetings: title, weekday (0 Sunday), start time, duration, every week or every other week (anchorDate is a day it meets on, fixing which weeks), attendees, whether the advisor is invited, whether it is active, who made it, and its next occurrence with the room already held for it (booked false until the daily run books it, 7 days ahead). Every member sees every series; only its creator can pause or delete it, and its creator or any member of its project group can edit its external link and agenda with update_meeting.",
  kind: "query",
  input: z.object({}),
  run: async () => {
    const rows = await db
      .select({ series: roomSeries, createdByName: user.name })
      .from(roomSeries)
      .innerJoin(user, eq(user.id, roomSeries.createdBy))
      .orderBy(asc(roomSeries.weekday), asc(roomSeries.startTime))
    const today = todayInTaipei()
    const next = new Map(
      rows.map(({ series }) => [
        series.id,
        series.active ? nextOccurrence(rule(series), today) : null,
      ])
    )
    const held = await seriesBookings(
      rows.map(({ series }) => series.id),
      [...new Set([...next.values()].filter((d) => d !== null))]
    )
    return {
      series: rows.map(({ series, createdByName }) => {
        const nextDate = next.get(series.id) ?? null
        const booking = held.find(
          (b) => b.seriesId === series.id && b.date === nextDate
        )
        return {
          id: series.id,
          title: plainTitle(series),
          meetingPrefix: series.meetingPrefix,
          weekday: series.weekday,
          startTime: series.startTime,
          durationMinutes: series.durationMinutes,
          intervalWeeks: series.intervalWeeks,
          anchorDate: series.anchorDate,
          attendees: series.attendees,
          includeAdvisor: series.includeAdvisor,
          onlineOnly: series.onlineOnly,
          groupName: series.groupName,
          agenda: series.agenda,
          externalUrl: series.externalUrl,
          active: series.active,
          createdBy: series.createdBy,
          createdByName,
          nextDate,
          nextBooked: Boolean(booking),
          nextRoom: booking?.room ?? null,
        }
      }),
    }
  },
})

/**
 * A room the lab's account holds for the whole span that no portal booking
 * accounts for, or null; exact when the hold starts and ends with the span
 * (the slots around it are not the lab's in that room). A reserve the
 * department accepted but never answered leaves exactly that, and booking
 * again would hold a second room. A wider hold is something else, such as
 * an old hold nobody released.
 */
async function strayLabHold(
  slots: Slot[],
  date: string,
  start: string,
  end: string
) {
  const span = slots.filter((slot) => slot.start >= start && slot.end <= end)
  if (!span.length) return null
  const held = span[0].labRooms.filter((room) =>
    span.every((slot) => slot.labRooms.includes(room))
  )
  if (!held.length) return null
  const ours = await db
    .select({ room: roomBookings.room })
    .from(roomBookings)
    .where(
      and(
        eq(roomBookings.date, date),
        eq(roomBookings.status, "booked"),
        lt(roomBookings.startTime, end),
        gt(roomBookings.endTime, start)
      )
    )
  const before = slots.find((slot) => slot.end === start)
  const after = slots.find((slot) => slot.start === end)
  const strays = held
    .filter((r) => !ours.some((row) => row.room === r))
    .map((room) => ({
      room,
      exact:
        !before?.labRooms.includes(room) && !after?.labRooms.includes(room),
    }))
  // An exact one matters most, whichever room it is in.
  return strays.find((stray) => stray.exact) ?? strays[0] ?? null
}

/**
 * The room one occurrence takes: the one the page would pick, a paid one
 * when no free room is open. Throws why there is none.
 */
async function roomForOccurrence(
  series: Series,
  date: string,
  endTime: string
) {
  if (!bookingConfigured()) throw new Error("Portal 還沒設定系上借用帳號")
  const slots = (await availability([date], true))[0].slots
  // A hold of exactly this span with no portal booking may be this
  // week's own reserve that never answered: ask the creator. A wider
  // one (an old hold nobody released) is not free, so another room is
  // picked; it is only logged.
  const stray = await strayLabHold(slots, date, series.startTime, endTime)
  if (stray?.exact)
    throw new Error(
      `系上已有實驗室帳號借的 ${stray.room}，portal 沒有這筆紀錄，可能是之前的預約沒收到回應；請確認後自己借或取消`
    )
  if (stray)
    emitErrorLog(new Error("lab hold without a portal booking"), {
      "room_series.id": series.id,
      room: stray.room,
      date,
    })
  return roomFor(slots, series.startTime, endTime, true)
}

/**
 * Books one occurrence: the room the page would pick (a paid one when no
 * free room is open, as the old portal did), else tells the creator when
 * notify. Skips an occurrence that has a booking, kept or cancelled, or
 * that the creator booked by hand. Returns "booked", "skipped", or the
 * failure.
 */
async function bookOccurrence(
  series: Series,
  date: string,
  notify = true
): Promise<"booked" | "skipped" | string> {
  // Read again just before booking, whatever the caller saw: a cancelled
  // row settles the day as much as a kept one.
  const [held] = await db
    .select({ id: roomBookings.id })
    .from(roomBookings)
    .where(
      and(eq(roomBookings.seriesId, series.id), eq(roomBookings.date, date))
    )
  if (held) return "skipped"
  const endTime = seriesEnd(series)!
  const [owner] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, series.createdBy))
  try {
    // The creator's hand bookings for the day take the same lock, so the
    // check below and the booking cannot interleave with one.
    return await withBookingLock(series.createdBy, date, async () => {
      // The creator may have booked the week by hand, as the failure mail
      // asks: the same span, no series. A second booking would hold two
      // rooms. Another meeting of theirs at that time is not the week.
      const [byHand] = await db
        .select({ id: roomBookings.id })
        .from(roomBookings)
        .where(
          and(
            eq(roomBookings.requestedBy, series.createdBy),
            eq(roomBookings.date, date),
            eq(roomBookings.status, "booked"),
            isNull(roomBookings.seriesId),
            eq(roomBookings.startTime, series.startTime),
            eq(roomBookings.endTime, endTime)
          )
        )
      if (byHand) return "skipped" as const
      // As a one-off online meeting: not over another of the creator's.
      if (series.onlineOnly) {
        const mine = await db
          .select({
            title: roomBookings.title,
            meetingPrefix: roomBookings.meetingPrefix,
            start: roomBookings.startTime,
            end: roomBookings.endTime,
          })
          .from(roomBookings)
          .where(
            and(
              eq(roomBookings.requestedBy, series.createdBy),
              eq(roomBookings.date, date),
              eq(roomBookings.status, "booked")
            )
          )
        const clash = mine.find((row) =>
          spansOverlap(row, { start: series.startTime, end: endTime })
        )
        if (clash)
          throw new Error(
            `你 ${clash.start} 到 ${clash.end} 已有「${plainTitle(clash)}」`
          )
      }
      const room = series.onlineOnly
        ? null
        : await roomForOccurrence(series, date, endTime)
      let attendees = series.attendees
      if (series.includeAdvisor) {
        const [advisor] = await db
          .select({ name: user.name, email: user.email })
          .from(user)
          .where(eq(user.username, ADVISOR_USERNAME))
        if (advisor) attendees = mergeAttendees(attendees, [advisor])
      }
      await placeBooking({
        date,
        startTime: series.startTime,
        endTime,
        room: room?.room ?? null,
        title: series.title,
        attendees,
        organizer: owner,
        online: series.online,
        externalUrl: series.externalUrl,
        meetingPrefix: series.meetingPrefix,
        groupName: series.groupName,
        agenda: series.agenda,
        issueRefs: series.issueRefs,
        deliverables: series.deliverables,
        seriesId: series.id,
      })
      return "booked" as const
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    emitErrorLog(error, { "room_series.id": series.id })
    if (notify)
      await queueMail(db, {
        to: [owner.email],
        subject: series.onlineOnly
          ? `[WinLab 會議] 固定會議這週沒建成：${series.title}`
          : `[WinLab 會議] 固定會議沒訂到教室：${series.title}`,
        ...mailBody({
          title: series.title,
          rows: [
            ["時間", `${dayLabel(date)} ${series.startTime} 到 ${endTime}`],
            ["原因", reason],
          ],
          paragraphs: [
            series.onlineOnly
              ? "請自己開這週的線上會議。"
              : "請自己借教室，或改成線上。",
          ],
          action: {
            label: series.onlineOnly ? "開會議" : "借教室",
            url: `${process.env.BETTER_AUTH_URL}/meetings`,
          },
        }),
      })
    return `${dayLabel(date)}：${reason}`
  }
}

export const standingMeetingInput = z.object({
  weekday: z.number().int().min(0).max(6),
  start_date: z
    .string()
    .refine(isCalendarDay, "日期要是 YYYY-MM-DD")
    .optional()
    .describe(
      "the first occurrence, on weekday; default the next one after today"
    ),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "時間要是 HH:MM"),
  duration_minutes: z
    .number()
    .int()
    .min(SERIES_MIN_MINUTES)
    .max(SERIES_MAX_MINUTES),
  interval_weeks: z.union([z.literal(1), z.literal(2)]).default(1),
  title: z.string().trim().max(80).default(DEFAULT_TOPIC),
  attendees: z.array(z.string().trim().min(1)).max(100).default([]),
  group: z.string().trim().min(1).nullish(),
  invite_group_members: z.boolean().default(true),
  include_advisor: z.boolean(),
  online_only: z
    .boolean()
    .default(false)
    .describe("no room, only the meet.winlab.tw meeting"),
  agenda: z.string().trim().max(2000).nullish(),
  external_url: z.string().trim().max(2000).nullish(),
  epic: z.string().trim().min(1).nullish(),
})

/**
 * Creates a standing meeting: every week or every other week from
 * start_date. Each occurrence gets a room 7 days ahead (free first, else
 * paid; none when online_only), a recorded Teams meeting and a calendar invite; the occurrences in
 * the coming week are booked at once, and failures are returned and mailed
 * to the member. book_meeting with repeat calls it.
 */
export async function createStandingMeeting(
  actorId: string,
  input: z.infer<typeof standingMeetingInput>
) {
  const endTime = input.online_only
    ? endAfter(input.start_time, input.duration_minutes)
    : addMinutes(input.start_time, input.duration_minutes)
  const problem = !endTime
    ? "超過當天可借的時間"
    : input.online_only
      ? onlineSpanProblem(input.start_time, endTime)
      : spanProblem(input.start_time, endTime)
  if (problem) throw new Error(problem)
  const group = input.group ?? null
  // The advisor joins each occurrence, read fresh, not frozen here.
  const attendees = await resolveAttendees({
    attendees: input.attendees,
    group,
    inviteGroup: input.invite_group_members,
    includeAdvisor: false,
  })
  let issueRefs: string[] = []
  let deliverables: string[] = []
  if (input.epic) {
    if (!group) throw new Error("要先選專案群組才能選 Epic")
    const path = (await projectGroups()).find(
      (g) => g.name === group
    )?.gitlabPath
    if (!path) throw new Error("這個群組沒有連到 GitLab")
    const iid = epicIid(input.epic, path)
    const epic = iid === null ? null : await getEpic(path, iid)
    if (!epic) throw new Error("Epic 不存在或不屬於這個群組")
    if (epic.kind !== "sync") throw new Error("固定會議只能選 Sync 類的 Epic")
    issueRefs = [`${path}&${epic.iid}`]
    deliverables = deliverablesOf(
      (await epicIssues(path, epic)).flatMap((i) => i.deliverables)
    )
  }
  // Frozen now: a series keeps filing under the same project all term.
  const prefix = topicPrefix(group, (await organizerOf(actorId)).username)
  const today = todayInTaipei()
  if (input.start_date !== undefined) {
    if (weekdayOf(input.start_date) !== input.weekday)
      throw new Error("第一場的日期要在那個星期")
    if (input.start_date < today) throw new Error("不能從過去的日期開始")
  }
  const [series] = await db
    .insert(roomSeries)
    .values({
      title: cleanTopic(input.title),
      weekday: input.weekday,
      startTime: input.start_time,
      durationMinutes: input.duration_minutes,
      intervalWeeks: input.interval_weeks,
      // Fixes which weeks an every-other-week series meets.
      anchorDate: input.start_date ?? nextWeekday(today, input.weekday),
      attendees,
      includeAdvisor: input.include_advisor,
      onlineOnly: input.online_only,
      meetingPrefix: prefix,
      groupName: group,
      agenda: input.agenda || null,
      externalUrl: externalMeetingUrl(input.external_url),
      issueRefs,
      deliverables,
      createdBy: actorId,
    })
    .returning()
  // Through 7 days out, as the daily run may already have looked at day 7
  // before this series existed. Today only when picked: its slot was free
  // on the grid a moment ago, while a default start is never today.
  const errors: string[] = []
  let booked = 0
  for (const date of occurrencesBetween(
    rule(series),
    input.start_date ?? addDays(today, 1),
    addDays(today, LEAD_DAYS)
  )) {
    const result = await bookOccurrence(series, date)
    if (result === "booked") booked++
    else if (result !== "skipped") errors.push(result)
  }
  return { id: series.id, booked, errors }
}

async function ownSeries(actorId: string, id: string) {
  const [series] = await db
    .select()
    .from(roomSeries)
    .where(eq(roomSeries.id, id))
  if (!series) throw new Error("找不到這個固定會議")
  if (series.createdBy !== actorId) throw new Error("只能改自己建立的固定會議")
  return series
}

export const setStandingMeetingActive = defineAction({
  name: "set_standing_meeting_active",
  title: "暫停或恢復固定會議",
  description:
    "Pauses (active false) or resumes (active true) one of the member's own standing meetings. A paused series books nothing new; occurrences already booked stay, and are cancelled with cancel_meeting. Resuming books, at the next daily run, every week within the coming 7 days that has no booking; to skip one week, keep it running and cancel that week's booking instead.",
  kind: "mutation",
  input: z.object({ id: z.uuid(), active: z.boolean() }),
  run: async (actor, { id, active }) => {
    await ownSeries(actor.userId, id)
    await db.update(roomSeries).set({ active }).where(eq(roomSeries.id, id))
    return { id, active }
  },
})

/**
 * Whether the member may edit a meeting: its creator, or a member of the
 * project group it files under. Membership is read live by Keycloak id,
 * not from the cached group list or a username, so someone just removed
 * from the group cannot edit; Keycloak not answering refuses the edit.
 */
async function mayEdit(
  actorId: string,
  meeting: { createdBy: string; groupName: string | null }
) {
  if (meeting.createdBy === actorId) return true
  if (!meeting.groupName) return false
  const [link] = await db
    .select({ sub: account.accountId })
    .from(account)
    .where(and(eq(account.userId, actorId), eq(account.providerId, "keycloak")))
  if (!link) return false
  return inProjectGroup(link.sub, meeting.groupName)
}

export const updateMeeting = defineAction({
  name: "update_meeting",
  title: "編輯會議",
  description:
    "Edits a booking (booking, an id from list_meetings) or a standing meeting (series, an id from list_standing_meetings; its booked occurrences from today on change too): external_url, the meeting people really join when it is someone else's, such as another company's Teams (https, null clears it), and agenda (null clears it). A key left out stays as it is. Its creator or any member of its project group may edit it. Mails nothing: invites already sent keep their old links; meet reads the agenda when the room opens. Not for the Monday lab meeting.",
  kind: "mutation",
  input: z
    .object({
      booking: z.uuid().optional(),
      series: z.uuid().optional(),
      external_url: z.string().trim().max(2000).nullish(),
      agenda: z.string().trim().max(2000).nullish(),
    })
    .refine((v) => Boolean(v.booking) !== Boolean(v.series), {
      message: "booking 和 series 要剛好給一個",
    }),
  run: async (actor, input) => {
    const patch: { externalUrl?: string | null; agenda?: string | null } = {}
    if (input.external_url !== undefined)
      patch.externalUrl = externalMeetingUrl(input.external_url)
    if (input.agenda !== undefined) patch.agenda = input.agenda || null
    if (!Object.keys(patch).length) throw new Error("沒有要改的欄位")
    if (input.series) {
      const [series] = await db
        .select()
        .from(roomSeries)
        .where(eq(roomSeries.id, input.series))
      if (!series) throw new Error("找不到這個固定會議")
      if (!(await mayEdit(actor.userId, series)))
        throw new Error("只有建立者和專案群組的成員能編輯")
      const bookings = await db.transaction(async (tx) => {
        await tx
          .update(roomSeries)
          .set(patch)
          .where(eq(roomSeries.id, series.id))
        return tx
          .update(roomBookings)
          .set(patch)
          .where(
            and(
              eq(roomBookings.seriesId, series.id),
              eq(roomBookings.status, "booked"),
              gte(roomBookings.date, todayInTaipei())
            )
          )
          .returning({ id: roomBookings.id })
      })
      return { series: series.id, ...patch, bookings: bookings.length }
    }
    const [booking] = await db
      .select({
        requestedBy: roomBookings.requestedBy,
        groupName: roomBookings.groupName,
        status: roomBookings.status,
        meetingId: roomBookings.meetingId,
      })
      .from(roomBookings)
      .where(eq(roomBookings.id, input.booking!))
    if (!booking || booking.status !== "booked")
      throw new Error("找不到這筆預約，或已經取消")
    if (booking.meetingId)
      throw new Error("週一 Lab Meeting 請到 /meetings 由報告人或管理員改")
    if (
      !(await mayEdit(actor.userId, {
        createdBy: booking.requestedBy,
        groupName: booking.groupName,
      }))
    )
      throw new Error("只有發起人和專案群組的成員能編輯")
    const [updated] = await db
      .update(roomBookings)
      .set(patch)
      // A cancel since the read above leaves the row alone.
      .where(
        and(
          eq(roomBookings.id, input.booking!),
          eq(roomBookings.status, "booked")
        )
      )
      .returning({ id: roomBookings.id })
    if (!updated) throw new Error("這筆預約剛被取消")
    return { booking: input.booking, ...patch, bookings: 1 }
  },
})

export const deleteStandingMeeting = defineAction({
  name: "delete_standing_meeting",
  title: "刪除固定會議",
  description:
    "Deletes one of the member's own standing meetings. Occurrences already booked stay booked; cancel them one by one with cancel_meeting.",
  kind: "mutation",
  input: z.object({ id: z.uuid() }),
  run: async (actor, { id }) => {
    await ownSeries(actor.userId, id)
    await db.delete(roomSeries).where(eq(roomSeries.id, id))
    return { deleted: true }
  },
})

/**
 * The daily run, once a day from 04:30 Taipei: books every active series'
 * occurrences up to 7 days out, then settles and reports Teams meetings that
 * failed. The day is claimed in room_daily_runs first, so a restart or a
 * second process never runs it twice.
 */
export async function runDailyRooms() {
  const today = todayInTaipei()
  const claimed = await db
    .insert(roomDailyRuns)
    .values({ date: today })
    .onConflictDoNothing()
    .returning()
  if (!claimed.length) return
  // Day 7 is the new one. The days before it are booked too when nothing
  // holds them, so a run that never happened (the server was down, or the
  // series was paused then) is made up. A failure mails on day 7 and once
  // more the day before, so a week that never had a day 7 still warns, and
  // nobody gets a mail a day for the same week.
  const from = addDays(today, 1)
  const to = addDays(today, LEAD_DAYS)
  const active = await db
    .select()
    .from(roomSeries)
    .where(eq(roomSeries.active, true))
  // Any row, kept or cancelled, settles a day: a week the creator
  // cancelled stays cancelled.
  const settled = new Set(
    active.length
      ? (
          await db
            .select({
              seriesId: roomBookings.seriesId,
              date: roomBookings.date,
            })
            .from(roomBookings)
            .where(
              and(
                inArray(
                  roomBookings.seriesId,
                  active.map((series) => series.id)
                ),
                gte(roomBookings.date, from),
                lte(roomBookings.date, to)
              )
            )
        ).map((row) => `${row.seriesId} ${row.date}`)
      : []
  )
  for (const series of active)
    for (const date of occurrencesBetween(rule(series), from, to))
      if (!settled.has(`${series.id} ${date}`))
        // One week that throws outside bookOccurrence's own handling must
        // not cost the other series, or the Teams sweep below, their day.
        await bookOccurrence(series, date, date === to || date === from).catch(
          (error) => emitErrorLog(error, { "room_series.id": series.id, date })
        )
  // The tick sweeps the Teams requests on its own, every 10 minutes.
  await announceChange("room_daily_run").catch(() => {})
}

/** Starts the daily run; called once per server process. */
export function startRoomsScheduler() {
  const tick = () => {
    const [hour, minute] = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(new Date())
      .split(":")
      .map(Number)
    // What a restart or a failed call left undone with Teams, any hour.
    void reconcileTeams()
      .then(sweepMeetingRequests)
      .catch((error) => emitErrorLog(error, {}))
    if (hour * 60 + minute < 4 * 60 + 30) return
    void runDailyRooms().catch((error) => emitErrorLog(error, {}))
  }
  setInterval(tick, 10 * 60_000).unref()
  tick()
}
