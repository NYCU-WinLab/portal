import { and, asc, eq, gt, gte, lt, lte, or, sql } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { syncCalendar } from "@/lib/actions/calendar"
import {
  bookMeeting,
  cancelBooking,
  withBookingLock,
} from "@/lib/actions/rooms"
import { db } from "@/lib/db"
import {
  appointments,
  appointmentSchedules,
  calendarEvents,
  calendarLinks,
  roomBookings,
  user,
  type AppointmentWindow,
} from "@/lib/db/schema"
import {
  addDays,
  clock,
  DAY_END_HOUR,
  DAY_START_HOUR,
  isCalendarDay,
  minutesOf,
  SLOT_MINUTES,
  spansOverlap,
  taipeiIso,
  todayInTaipei,
  weekdayOf,
} from "@/lib/rooms/time"

// Appointment schedules, like Google Calendar's: a member who linked a
// calendar opens weekly windows, and labmates book a free slot in them. A
// booking is an ordinary portal meeting (book_meeting) organized by the
// booker with the member invited, so it gets the same meet room, recording
// and invites. A slot is free when no Google event and no portal meeting of
// the member's overlaps it.

/** A slot can be booked from this long before it starts. */
const NOTICE_MINUTES = 120
/** Slots are offered only from a calendar synced this recently (the sync
 * runs every 5 minutes); a booking syncs the calendar again first. */
const FRESH_MS = 15 * 60_000

const gridTime = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "時間要是 HH:MM")
  .refine(
    (value) => {
      const minutes = minutesOf(value)
      return (
        minutes !== null &&
        minutes % SLOT_MINUTES === 0 &&
        minutes >= DAY_START_HOUR * 60 &&
        minutes <= DAY_END_HOUR * 60
      )
    },
    `時間要在 ${clock(DAY_START_HOUR * 60)} 到 ${clock(DAY_END_HOUR * 60)}，對齊 ${SLOT_MINUTES} 分鐘`
  )

const windowInput = z.object({
  weekday: z.number().int().min(0).max(6),
  start: gridTime,
  end: gridTime,
})

const day = z.string().refine(isCalendarDay, "日期要是 YYYY-MM-DD")

type Schedule = typeof appointmentSchedules.$inferSelect

async function scheduleOf(userId: string) {
  const [row] = await db
    .select()
    .from(appointmentSchedules)
    .where(eq(appointmentSchedules.userId, userId))
  return row ?? null
}

/**
 * The slot starts still free for the owner on each day from..to (inclusive),
 * read fresh: windows minus Google events, portal meetings they organize or
 * are invited to, and slots starting within NOTICE_MINUTES.
 */
async function freeSlots(
  owner: { id: string; email: string },
  schedule: Schedule,
  from: string,
  to: string
) {
  const start = new Date(`${from}T00:00:00+08:00`)
  const end = new Date(`${addDays(to, 1)}T00:00:00+08:00`)
  const [events, bookings] = await Promise.all([
    db
      .select({ start: calendarEvents.startsAt, end: calendarEvents.endsAt })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.userId, owner.id),
          lt(calendarEvents.startsAt, end),
          gt(calendarEvents.endsAt, start)
        )
      ),
    db
      .select({
        date: roomBookings.date,
        start: roomBookings.startTime,
        end: roomBookings.endTime,
      })
      .from(roomBookings)
      .where(
        and(
          eq(roomBookings.status, "booked"),
          gte(roomBookings.date, from),
          lte(roomBookings.date, to),
          or(
            eq(roomBookings.requestedBy, owner.id),
            sql`exists (select 1 from jsonb_array_elements(${roomBookings.attendees}) a where lower(a->>'email') = ${owner.email.toLowerCase()})`
          )
        )
      ),
  ])
  const earliest = Date.now() + NOTICE_MINUTES * 60_000
  const days: { date: string; starts: string[] }[] = []
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const starts: string[] = []
    for (const window of schedule.windows) {
      if (window.weekday !== weekdayOf(date)) continue
      const last = minutesOf(window.end)!
      for (
        let at = minutesOf(window.start)!;
        at + schedule.slotMinutes <= last;
        at += schedule.slotMinutes
      ) {
        const slot = { start: clock(at), end: clock(at + schedule.slotMinutes) }
        const slotStart = new Date(taipeiIso(date, slot.start)).getTime()
        const slotEnd = slotStart + schedule.slotMinutes * 60_000
        if (slotStart < earliest) continue
        if (
          events.some(
            (event) =>
              event.start.getTime() < slotEnd && event.end.getTime() > slotStart
          )
        )
          continue
        if (
          bookings.some(
            (booking) => booking.date === date && spansOverlap(booking, slot)
          )
        )
          continue
        starts.push(slot.start)
      }
    }
    if (starts.length) days.push({ date, starts: starts.sort() })
  }
  return days
}

async function ownerOf(userId: string) {
  const [owner] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      syncedAt: calendarLinks.syncedAt,
      syncError: calendarLinks.syncError,
    })
    .from(user)
    .innerJoin(calendarLinks, eq(calendarLinks.userId, user.id))
    .where(eq(user.id, userId))
  return owner ?? null
}

/** Whether the copy of the owner's calendar can be trusted to say free. */
const current = (owner: { syncedAt: Date | null; syncError: string | null }) =>
  !owner.syncError &&
  !!owner.syncedAt &&
  Date.now() - owner.syncedAt.getTime() < FRESH_MS

export const getMyAppointmentSchedule = defineAction({
  name: "get_my_appointment_schedule",
  title: "我的預約時段",
  description:
    "The signed-in member's appointment schedule: weekly windows (weekday 0 = Sunday, Asia/Taipei HH:MM), slot length in minutes and how many days ahead labmates may book, or null when they take no appointments. Also their upcoming appointments: meetings labmates booked with them (booking id for cancel_meeting, date, start, end, title, who booked). linked is false when they have not linked a Google Calendar, which a schedule needs.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const [link] = await db
      .select({ userId: calendarLinks.userId })
      .from(calendarLinks)
      .where(eq(calendarLinks.userId, actor.userId))
    const schedule = await scheduleOf(actor.userId)
    const booked = await db
      .select({
        id: roomBookings.id,
        date: roomBookings.date,
        start: roomBookings.startTime,
        end: roomBookings.endTime,
        title: roomBookings.title,
        bookedBy: user.name,
      })
      .from(appointments)
      .innerJoin(roomBookings, eq(roomBookings.id, appointments.bookingId))
      .innerJoin(user, eq(user.id, roomBookings.requestedBy))
      .where(
        and(
          eq(appointments.ownerId, actor.userId),
          eq(roomBookings.status, "booked"),
          gte(roomBookings.date, todayInTaipei())
        )
      )
      .orderBy(asc(roomBookings.date), asc(roomBookings.startTime))
    return {
      linked: !!link,
      schedule: schedule && {
        windows: schedule.windows,
        slotMinutes: schedule.slotMinutes,
        aheadDays: schedule.aheadDays,
      },
      appointments: booked,
    }
  },
})

export const setAppointmentSchedule = defineAction({
  name: "set_appointment_schedule",
  title: "設定預約時段",
  description:
    "Sets when labmates may book a meeting with the signed-in member: weekly windows (weekday 0 = Sunday; start and end Asia/Taipei HH:MM on the 30-minute grid between 08:00 and 22:00), slot_minutes 30 or 60, and ahead_days (1 to 60) for how far ahead. Free slots are the windows minus the member's Google Calendar events and portal meetings. An empty windows list stops taking appointments; booked ones stay. Needs a linked Google Calendar.",
  kind: "mutation",
  input: z.object({
    windows: z.array(windowInput).max(21),
    slot_minutes: z.union([z.literal(30), z.literal(60)]).default(30),
    ahead_days: z.number().int().min(1).max(60).default(14),
  }),
  run: async (actor, input) => {
    if (!input.windows.length) {
      await db
        .delete(appointmentSchedules)
        .where(eq(appointmentSchedules.userId, actor.userId))
      return { schedule: null }
    }
    const windows: AppointmentWindow[] = input.windows
      .map((w) => ({ weekday: w.weekday, start: w.start, end: w.end }))
      .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start))
    for (const [i, w] of windows.entries()) {
      const from = minutesOf(w.start)!
      const to = minutesOf(w.end)!
      if (to - from < input.slot_minutes)
        throw new Error(
          `${w.start} 到 ${w.end} 放不下一段 ${input.slot_minutes} 分鐘`
        )
      const next = windows[i + 1]
      if (next && next.weekday === w.weekday && spansOverlap(w, next))
        throw new Error(`同一天的時段 ${w.start} 和 ${next.start} 重疊了`)
    }
    const [link] = await db
      .select({ userId: calendarLinks.userId })
      .from(calendarLinks)
      .where(eq(calendarLinks.userId, actor.userId))
    if (!link) throw new Error("先連結 Google 行事曆，才能開放預約")
    const values = {
      windows,
      slotMinutes: input.slot_minutes,
      aheadDays: input.ahead_days,
    }
    await db
      .insert(appointmentSchedules)
      .values({ userId: actor.userId, ...values })
      .onConflictDoUpdate({ target: appointmentSchedules.userId, set: values })
    return { schedule: values }
  },
})

export const listAppointmentSlots = defineAction({
  name: "list_appointment_slots",
  title: "可預約時段",
  description:
    "The free slots a member offers for booking a meeting with them, from today to their ahead_days: per day (YYYY-MM-DD), the Asia/Taipei start times, each slot_minutes long. Free means inside their weekly windows, at least 2 hours from now, and clear of their Google Calendar events and portal meetings. schedule is false when they take no appointments; synced is false (and days empty) while their calendar has not synced in the last 15 minutes. Book one with book_appointment.",
  kind: "query",
  input: z.object({ user_id: z.uuid() }),
  run: async (_actor, input) => {
    const owner = await ownerOf(input.user_id)
    if (!owner) throw new Error("這位成員沒有連結行事曆")
    const schedule = await scheduleOf(owner.id)
    if (!schedule)
      return {
        name: owner.name,
        schedule: false,
        synced: true,
        slotMinutes: 0,
        days: [],
      }
    // A calendar the portal cannot read now would show busy times as free.
    if (!current(owner))
      return {
        name: owner.name,
        schedule: true,
        synced: false,
        slotMinutes: schedule.slotMinutes,
        days: [],
      }
    const today = todayInTaipei()
    return {
      name: owner.name,
      schedule: true,
      synced: true,
      slotMinutes: schedule.slotMinutes,
      days: await freeSlots(
        owner,
        schedule,
        today,
        addDays(today, schedule.aheadDays)
      ),
    }
  },
})

export const bookAppointment = defineAction({
  name: "book_appointment",
  title: "預約會議",
  description:
    "Books a meeting with a member in one of their free appointment slots (list_appointment_slots): date, start_time and title; it lasts their slot length. It is an ordinary portal meeting organized by the signed-in member with the member booked as the attendee: a meet.winlab.tw room, recorded with a transcript, and calendar invites mailed to both. online_only (default true) books no room; false also books a CS department room (free first, a paid one only with allow_paid). Either side can cancel it with cancel_meeting. Read back the member, date, time, title and room or online, and get a yes first: it mails them.",
  kind: "mutation",
  input: z.object({
    user_id: z.uuid(),
    date: day,
    start_time: z.string().regex(/^\d{2}:\d{2}$/, "時間要是 HH:MM"),
    title: z.string().trim().min(1, "要有標題").max(80),
    agenda: z.string().trim().max(2000).nullish(),
    online_only: z.boolean().default(true),
    allow_paid: z.boolean().default(false),
  }),
  run: async (actor, input) => {
    if (input.user_id === actor.userId) throw new Error("不能預約自己")
    const owner = await ownerOf(input.user_id)
    if (!owner) throw new Error("這位成員沒有連結行事曆")
    // Both members' booking locks for the day, in a fixed order: no other
    // booking of either one (by hand, a standing meeting or another
    // appointment, either way round) can take the slot meanwhile.
    const [first, second] = [actor.userId, owner.id].sort()
    return withBookingLock(first, input.date, () =>
      withBookingLock(second, input.date, async () => {
        // Ask Google again: an event added since the last sync must count.
        await syncCalendar(owner.id)
        const fresh = await ownerOf(owner.id)
        if (!fresh || !current(fresh))
          throw new Error(`${owner.name} 的行事曆現在同步不了，稍後再試`)
        const schedule = await scheduleOf(owner.id)
        if (!schedule) throw new Error(`${owner.name} 沒有開放預約`)
        const today = todayInTaipei()
        if (input.date > addDays(today, schedule.aheadDays))
          throw new Error(`最多預約 ${schedule.aheadDays} 天後`)
        const [free] = await freeSlots(owner, schedule, input.date, input.date)
        if (!free?.starts.includes(input.start_time))
          throw new Error("這個時段已經沒空了，換一個時段")
        const end = clock(minutesOf(input.start_time)! + schedule.slotMinutes)
        const booked = await bookMeeting.run(
          actor,
          bookMeeting.input.parse({
            date: input.date,
            start_time: input.start_time,
            end_time: end,
            online_only: input.online_only,
            allow_paid: input.allow_paid,
            title: input.title,
            attendees: [owner.id],
            include_advisor: false,
            agenda: input.agenda,
          })
        )
        if (!("id" in booked)) throw new Error("預約沒有成立")
        try {
          await db
            .insert(appointments)
            .values({ bookingId: booked.id, ownerId: owner.id })
        } catch (error) {
          // Without the link the member booked could not cancel it: undo it.
          const [row] = await db
            .select()
            .from(roomBookings)
            .where(eq(roomBookings.id, booked.id))
          if (row) await cancelBooking(row, actor.userId).catch(() => {})
          throw error
        }
        return {
          id: booked.id,
          with: owner.name,
          date: input.date,
          start: input.start_time,
          end,
          room: booked.room,
        }
      })
    )
  },
})
