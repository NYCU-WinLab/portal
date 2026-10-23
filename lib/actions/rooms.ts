import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { queueMail } from "@/lib/actions/mail"
import {
  cancelMeeting,
  joinUrl,
  meetingsOf,
  requestMeeting,
} from "@/lib/actions/rooms-meetings"
import type { Mail } from "@/lib/mail"
import { mailBody } from "@/lib/mail-body"
import { db } from "@/lib/db"
import { roomBookings, user } from "@/lib/db/schema"
import {
  epicIssues,
  epicsConfigured,
  getEpic,
  listOpenEpics,
} from "@/lib/gitlab"
import { projectGroups } from "@/lib/keycloak"
import {
  bookingConfigured,
  labAccount,
  listBusy,
  listRooms,
  release,
  reserve,
} from "@/lib/meetingroom"
import {
  daySlots,
  mergeRuns,
  pickRoom,
  type Slot,
} from "@/lib/rooms/availability"
import {
  ADVISOR_USERNAME,
  DEFAULT_TOPIC,
  calendarInvite,
  composeTopic,
  deliverablesOf,
  epicIid,
  mergeAttendees,
  topicPrefix,
  type Attendee,
} from "@/lib/rooms/meeting"
import {
  addDays,
  dayLabel,
  isCalendarDay,
  spanProblem,
  taipeiIso,
  todayInTaipei,
} from "@/lib/rooms/time"

const day = z.string().refine(isCalendarDay, "日期要是 YYYY-MM-DD")
const time = z.string().regex(/^\d{2}:\d{2}$/, "時間要是 HH:MM")

/** The department's free and busy rooms on each day, on the 30-minute grid. */
export async function availability(days: string[], fresh = false) {
  const rooms = await listRooms()
  const busy = await listBusy(
    rooms.filter((room) => room.active).map((room) => room.name),
    days,
    fresh
  )
  return days.map((date) => ({
    date,
    slots: daySlots(rooms, busy.get(date) ?? [], date, labAccount()),
  }))
}

export const listRoomAvailability = defineAction({
  name: "list_room_availability",
  title: "教室空檔",
  description:
    "Free and busy time in the CS department's meeting rooms for up to 14 days from date (Asia/Taipei), read live from the department system, the grid 新增會議 on /meetings draws. Each run of the 30-minute grid lists the free-tier rooms open, the paid ones, and the rooms the lab's shared account already holds; lab_bookings says who booked those through the portal and what for. Every member gets the same answer. Book a slot with book_room.",
  kind: "query",
  input: z.object({
    date: day.optional(),
    days: z.number().int().min(1).max(14).default(1),
    merge: z
      .boolean()
      .default(true)
      .describe("false returns every 30-minute slot instead of merged runs"),
  }),
  run: async (_actor, { date, days, merge }) => {
    const from = date ?? todayInTaipei()
    const dates = Array.from({ length: days }, (_, i) => addDays(from, i))
    const [grid, booked] = await Promise.all([
      availability(dates),
      bookingsBetween(from, dates.at(-1)!),
    ])
    return {
      days: grid.map(({ date, slots }) => ({
        date,
        ...(merge ? { runs: mergeRuns(slots) } : { slots }),
        labBookings: booked
          .filter((b) => b.date === date && b.room && b.status === "booked")
          .map((b) => ({
            id: b.id,
            room: b.room,
            startTime: b.startTime,
            endTime: b.endTime,
            title: b.title,
            requestedBy: b.requestedBy,
            requestedByName: b.requestedByName,
          })),
      })),
    }
  },
})

async function bookingsBetween(from: string, to: string) {
  const rows = await db
    .select({
      id: roomBookings.id,
      date: roomBookings.date,
      startTime: roomBookings.startTime,
      endTime: roomBookings.endTime,
      room: roomBookings.room,
      online: roomBookings.online,
      status: roomBookings.status,
      title: roomBookings.title,
      agenda: roomBookings.agenda,
      groupName: roomBookings.groupName,
      attendees: roomBookings.attendees,
      seriesId: roomBookings.seriesId,
      meetingId: roomBookings.meetingId,
      requestedBy: roomBookings.requestedBy,
      requestedByName: user.name,
      cancelledAt: roomBookings.cancelledAt,
    })
    .from(roomBookings)
    .innerJoin(user, eq(user.id, roomBookings.requestedBy))
    .where(and(gte(roomBookings.date, from), lte(roomBookings.date, to)))
    .orderBy(asc(roomBookings.date), asc(roomBookings.startTime))
  const meetings = await meetingsOf(rows.map((row) => row.id))
  return rows.map((row) => ({
    ...row,
    meeting: row.online ? (meetings.get(row.id) ?? null) : null,
  }))
}

export const listRoomBookings = defineAction({
  name: "list_room_bookings",
  title: "會議預約",
  description:
    "The meetings booked through the portal from date (default today, Asia/Taipei) for days days: room (null for an online-only meeting), date, start and end, status booked or cancelled (cancelled rows stay), title, agenda, project group, attendees, who booked it, and the Teams meeting's state (pending, success with join_url, or failed with the reason). Every member sees every booking; only the member who booked one can cancel it with cancel_room_booking.",
  kind: "query",
  input: z.object({
    date: day.optional(),
    days: z.number().int().min(1).max(90).default(7),
  }),
  run: async (_actor, { date, days }) => {
    const from = date ?? todayInTaipei()
    return { bookings: await bookingsBetween(from, addDays(from, days - 1)) }
  },
})

export const listRoomGroups = defineAction({
  name: "list_room_groups",
  title: "專案群組",
  description:
    "The lab's project groups in Keycloak (/winlab-projects), each with its slug name (the Teams topic prefix and what book_room's group takes), a label, whether it is linked to a GitLab group (only then can a meeting belong to an epic), the members who can be invited, and the names of members with no email.",
  kind: "query",
  input: z.object({}),
  run: async () => ({
    groups: (await projectGroups()).map(({ gitlabPath, ...group }) => ({
      ...group,
      gitlabLinked: gitlabPath !== null,
    })),
  }),
})

async function gitlabPathOf(groupName: string) {
  const group = (await projectGroups()).find((g) => g.name === groupName)
  if (!group) throw new Error(`沒有「${groupName}」這個專案群組`)
  if (!group.gitlabPath) throw new Error(`「${group.label}」沒有連到 GitLab`)
  return group.gitlabPath
}

export const listGroupEpics = defineAction({
  name: "list_group_epics",
  title: "群組 Epic",
  description:
    "The open GitLab epics of one project group (by its slug name from list_room_groups), most recently updated first: iid, title, description, url and kind. kind sync is a standing container (a series may only use these), meeting is one tracked meeting, report is a review over an iteration. Pass an iid as book_room's epic.",
  kind: "query",
  input: z.object({ group: z.string().trim().min(1) }),
  run: async (_actor, { group }) => {
    if (!epicsConfigured()) return { epics: [] }
    return { epics: await listOpenEpics(await gitlabPathOf(group)) }
  },
})

/**
 * The epic a meeting belongs to, read back from GitLab: its reference and
 * what the meeting owes. Resolved against the group's own GitLab path, so
 * a caller can never point a meeting at another group's epic.
 */
async function resolveEpic(
  groupName: string | null,
  ref: string | null,
  forSeries: boolean
) {
  if (!ref) return { issueRefs: [], deliverables: [] as string[] }
  if (!groupName) throw new Error("要先選專案群組才能選 Epic")
  const path = await gitlabPathOf(groupName)
  const iid = epicIid(ref, path)
  if (iid === null) throw new Error("Epic 不屬於這個群組")
  const epic = await getEpic(path, iid)
  if (!epic) throw new Error(`Epic &${iid} 不存在`)
  if (forSeries && epic.kind !== "sync")
    throw new Error("固定會議只能選 Sync 類的 Epic")
  const issues = await epicIssues(path, epic)
  return {
    issueRefs: [`${path}&${epic.iid}`],
    deliverables: deliverablesOf(issues.flatMap((issue) => issue.deliverables)),
  }
}

export const getEpicDeliverables = defineAction({
  name: "get_epic_deliverables",
  title: "Epic 交付項目",
  description:
    "What a meeting under this epic owes: the GitLab Deliverable labels (Presentation, Report, Code, Demo) on the epic's child issues, or on every issue of a report's iteration, with each issue's title and url. A sync epic owes nothing itself. group is the project group's slug, epic the epic's iid or reference.",
  kind: "query",
  input: z.object({
    group: z.string().trim().min(1),
    epic: z.string().trim().min(1),
  }),
  run: async (_actor, { group, epic }) => {
    const path = await gitlabPathOf(group)
    const iid = epicIid(epic, path)
    if (iid === null) throw new Error("Epic 不屬於這個群組")
    const found = await getEpic(path, iid)
    if (!found) throw new Error(`Epic &${iid} 不存在`)
    const issues = await epicIssues(path, found)
    return {
      kind: found.kind,
      deliverables: deliverablesOf(issues.flatMap((i) => i.deliverables)),
      issues,
    }
  },
})

type Member = {
  id: string
  name: string
  email: string
  username: string | null
}

const members = (): Promise<Member[]> =>
  db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
    })
    .from(user)

/**
 * Who to invite: the group's members (unless left out), members named by
 * portal id, email or username, and the advisor when asked. Portal names
 * win over Keycloak's, which are often English.
 */
export async function resolveAttendees(input: {
  attendees: string[]
  group: string | null
  inviteGroup: boolean
  includeAdvisor: boolean
}) {
  const everyone = await members()
  const byEmail = new Map(everyone.map((m) => [m.email.toLowerCase(), m]))
  let out: Attendee[] = []
  if (input.group && input.inviteGroup) {
    const group = (await projectGroups()).find((g) => g.name === input.group)
    if (!group) throw new Error(`沒有「${input.group}」這個專案群組`)
    out = mergeAttendees(
      out,
      group.members.map((m) => ({
        name: byEmail.get(m.email.toLowerCase())?.name ?? m.name,
        email: m.email,
        username: m.username,
      }))
    )
  }
  const unknown: string[] = []
  for (const wanted of input.attendees) {
    const key = wanted.trim().toLowerCase()
    const member = everyone.find(
      (m) =>
        m.id === key ||
        m.email.toLowerCase() === key ||
        m.username?.toLowerCase() === key
    )
    if (!member) unknown.push(wanted)
    else
      out = mergeAttendees(out, [
        {
          name: member.name,
          email: member.email,
          ...(member.username && member.username !== ADVISOR_USERNAME
            ? { username: member.username }
            : {}),
        },
      ])
  }
  if (unknown.length) throw new Error(`找不到成員：${unknown.join("、")}`)
  if (input.includeAdvisor) {
    const advisor = everyone.find((m) => m.username === ADVISOR_USERNAME)
    if (!advisor) throw new Error("找不到老師的帳號")
    // No username: the advisor never names the recording's project.
    out = mergeAttendees(out, [{ name: advisor.name, email: advisor.email }])
  }
  return out
}

export type Booking = typeof roomBookings.$inferSelect
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Where a booking happens, as members read it. */
export const placeOf = (booking: Booking) =>
  booking.room ? `資工系 ${booking.room}` : (booking.place ?? "線上")

/** A booking's calendar event, for its invite or its cancellation. */
export function bookingCalendar(
  booking: Booking,
  organizer: { name: string; email: string },
  method: "REQUEST" | "CANCEL"
) {
  return {
    ics: calendarInvite({
      uid: `rooms-${booking.id}@portal.winlab.tw`,
      method,
      sequence: booking.inviteSequence,
      title: booking.title,
      location: booking.room || booking.place ? placeOf(booking) : "線上會議",
      start: taipeiIso(booking.date, booking.startTime),
      end: taipeiIso(booking.date, booking.endTime),
      organizer,
      attendees: booking.attendees,
      // A mailing list stands for the whole lab: replies would all land on
      // the organizer.
      rsvp: !booking.meetingId,
      joinUrl:
        booking.online && method === "REQUEST" ? joinUrl(booking.id) : null,
    }),
    icsMethod: method,
  }
}

/** The invite (or cancellation) for a booking, to the organizer and every
 * attendee, with the calendar event attached. */
function inviteMail(
  booking: Booking,
  organizer: { name: string; email: string },
  method: "REQUEST" | "CANCEL"
) {
  const when = `${dayLabel(booking.date)} ${booking.startTime} 到 ${booking.endTime}`
  const link =
    booking.online && method === "REQUEST" ? joinUrl(booking.id) : null
  const to = mergeAttendees(
    [{ name: organizer.name, email: organizer.email }],
    booking.attendees
  ).map((a) => a.email)
  return {
    to,
    replyTo: organizer.email,
    subject: `[WinLab 會議] ${method === "CANCEL" ? "已取消" : "邀請"}：${booking.title}（${when}）`,
    ...mailBody({
      title: method === "CANCEL" ? `已取消：${booking.title}` : booking.title,
      rows: [
        ["時間", when],
        ["地點", placeOf(booking)],
        ["發起人", organizer.name],
        ...(booking.attendees.length
          ? [
              ["與會", booking.attendees.map((a) => a.name).join("、")] as [
                string,
                string,
              ],
            ]
          : []),
      ],
      paragraphs: booking.agenda ? [booking.agenda] : [],
      action: link ? { label: "加入會議", url: link } : undefined,
    }),
    ...bookingCalendar(booking, organizer, method),
  }
}

export type NewBooking = {
  date: string
  startTime: string
  endTime: string
  /** Null books no room: a Teams meeting only. */
  room: string | null
  title: string
  attendees: Attendee[]
  organizer: { id: string; name: string; email: string }
  online: boolean
  meetingPrefix: string | null
  groupName: string | null
  agenda: string | null
  issueRefs: string[]
  deliverables: string[]
  seriesId?: string
  /** The Monday lab meeting this booking is for. */
  meetingId?: string
  place?: string
  /** Replaces the usual invite, as the lab meeting's announcement does. */
  invite?: (booking: Booking) => Mail
  /** Runs first in the booking's transaction; throwing books nothing. */
  inTransaction?: (tx: Tx) => Promise<void>
}

/**
 * Reserves the room in the department system, records the booking with its
 * invite, then asks for the Teams meeting. A reservation the portal fails
 * to record is released again, so nothing is held that nobody can cancel.
 */
export async function placeBooking(input: NewBooking) {
  const start = taipeiIso(input.date, input.startTime)
  const end = taipeiIso(input.date, input.endTime)
  const externalId = input.room
    ? await reserve({ room: input.room, start, end })
    : null
  let booking: Booking
  try {
    booking = await db.transaction(async (tx) => {
      await input.inTransaction?.(tx)
      const [created] = await tx
        .insert(roomBookings)
        .values({
          externalId,
          room: input.room,
          date: input.date,
          startTime: input.startTime,
          endTime: input.endTime,
          title: input.title,
          attendees: input.attendees,
          online: input.online,
          meetingPrefix: input.meetingPrefix,
          groupName: input.groupName,
          agenda: input.agenda,
          issueRefs: input.issueRefs,
          deliverables: input.deliverables,
          seriesId: input.seriesId,
          meetingId: input.meetingId,
          place: input.place,
          requestedBy: input.organizer.id,
        })
        .returning()
      await queueMail(
        tx,
        input.invite?.(created) ??
          inviteMail(created, input.organizer, "REQUEST")
      )
      return created
    })
  } catch (error) {
    if (externalId && input.room)
      await release(externalId, { room: input.room, start, end }).catch(
        () => {}
      )
    throw error
  }
  await requestMeeting(booking)
  return booking
}

async function organizerOf(userId: string) {
  const [me] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
  if (!me) throw new Error("找不到你的帳號")
  return me
}

/** The room the page would pick for a span, or why there is none. */
export function roomFor(
  slots: Slot[],
  start: string,
  end: string,
  allowPaid: boolean
) {
  const picked = pickRoom(slots, start, end)
  if (!picked)
    throw new Error("這段時間沒有教室從頭到尾都空著，換個時段或改成線上")
  if (picked.paid && !allowPaid)
    throw new Error(`只剩付費教室 ${picked.room}，同意付費才能借`)
  return picked
}

export const bookRoom = defineAction({
  name: "book_room",
  title: "預約會議",
  description:
    "Books a meeting as the member, 新增會議 on /meetings: a CS department room through the lab's shared account (the room /meetings would pick: open for the whole span, free before paid; a paid room only with allow_paid true, since the department charges for it), or no room with online_only. Every booking also gets a Teams meeting in the WinLab channel, recorded automatically with a transcript and an AI summary the channel can see, and every attendee and the member get a calendar invite by mail. Times are Asia/Taipei HH:MM on the 30-minute grid between 08:00 and 22:00; check list_room_availability first. attendees are portal user ids, emails or usernames; group is a project group's slug from list_room_groups, whose members are invited too unless invite_group_members is false, and which names the project the recording files under. epic (an iid from list_group_epics) needs a group linked to GitLab. include_advisor has no default because it mails the advisor. Never book the Monday lab meeting here; the portal books it itself. Read back the date, time, room or online, title, attendees, advisor and the recording, and get the member's yes first.",
  kind: "mutation",
  input: z.object({
    date: day,
    start_time: time,
    end_time: time,
    online_only: z.boolean().default(false),
    allow_paid: z.boolean().default(false),
    title: z.string().trim().max(80).default(DEFAULT_TOPIC),
    attendees: z.array(z.string().trim().min(1)).max(100).default([]),
    group: z.string().trim().min(1).nullish(),
    invite_group_members: z.boolean().default(true),
    include_advisor: z.boolean(),
    agenda: z.string().trim().max(2000).nullish(),
    epic: z.string().trim().min(1).nullish(),
  }),
  run: async (actor, input) => {
    const problem = spanProblem(input.start_time, input.end_time)
    if (problem) throw new Error(problem)
    if (input.date < todayInTaipei()) throw new Error("不能借過去的日期")
    if (!input.online_only && !bookingConfigured())
      throw new Error("Portal 還沒設定系上借用帳號，只能開線上會議")
    const group = input.group ?? null
    const attendees = await resolveAttendees({
      attendees: input.attendees,
      group,
      inviteGroup: input.invite_group_members,
      includeAdvisor: input.include_advisor,
    })
    const epic = await resolveEpic(group, input.epic ?? null, false)
    // Picked from a fresh read, not the grid the member clicked minutes ago.
    const room = input.online_only
      ? null
      : roomFor(
          (await availability([input.date], true))[0].slots,
          input.start_time,
          input.end_time,
          input.allow_paid
        )
    const prefix = topicPrefix(group, attendees)
    const booking = await placeBooking({
      date: input.date,
      startTime: input.start_time,
      endTime: input.end_time,
      room: room?.room ?? null,
      title: composeTopic(prefix, input.title),
      attendees,
      organizer: await organizerOf(actor.userId),
      // Every portal meeting gets a recording to look back at.
      online: true,
      meetingPrefix: prefix,
      groupName: group,
      agenda: input.agenda || null,
      ...epic,
    })
    return {
      id: booking.id,
      room: booking.room,
      paid: room?.paid ?? false,
      title: booking.title,
      attendees: attendees.length,
    }
  },
})

export const cancelRoomBooking = defineAction({
  name: "cancel_room_booking",
  title: "取消預約",
  description:
    "Cancels one of the member's own bookings (by id from list_room_bookings): releases the department room, takes down its Teams meeting and mails everyone the cancellation. Only the member who booked it; fails on someone else's or one already cancelled. teams_error is set when the Teams meeting could not be taken down: it will still start and record unless someone deletes it in Teams.",
  kind: "mutation",
  input: z.object({ id: z.uuid("id 是預約的 id") }),
  run: async (actor, { id }) => {
    const [booking] = await db
      .select()
      .from(roomBookings)
      .where(and(eq(roomBookings.id, id), eq(roomBookings.status, "booked")))
    if (!booking) throw new Error("找不到這筆預約，或已經取消")
    if (booking.requestedBy !== actor.userId)
      throw new Error("只能取消自己的預約")
    if (booking.meetingId)
      throw new Error("這是週一 Lab Meeting 的會議，請到 /meetings 請管理員改")
    return cancelBooking(booking, actor.userId)
  },
})

/**
 * Cancels a booking: releases its department room, mails everyone the
 * cancellation and takes down its Teams meeting. teams_error says why the
 * Teams meeting could not be taken down.
 */
export async function cancelBooking(booking: Booking, cancelledBy: string) {
  if (booking.externalId && booking.room)
    await release(booking.externalId, {
      room: booking.room,
      start: taipeiIso(booking.date, booking.startTime),
      end: taipeiIso(booking.date, booking.endTime),
    })
  const organizer = await organizerOf(booking.requestedBy)
  const cancelled = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(roomBookings)
      .set({
        status: "cancelled",
        cancelledAt: sql`now()`,
        cancelledBy,
        // A CANCEL must outrank the REQUEST, or calendars ignore it.
        inviteSequence: sql`${roomBookings.inviteSequence} + 1`,
      })
      // Two cancels at once: only the first changes the row.
      .where(
        and(eq(roomBookings.id, booking.id), eq(roomBookings.status, "booked"))
      )
      .returning()
    if (!row) throw new Error("這筆預約已經取消")
    await queueMail(tx, inviteMail(row, organizer, "CANCEL"))
    return row
  })
  const teamsError = await cancelMeeting(cancelled)
  return { cancelled: true, teams_error: teamsError }
}

/** For the series page: the bookings that already hold these occurrences. */
export async function seriesBookings(seriesIds: string[], dates: string[]) {
  if (!seriesIds.length || !dates.length) return []
  return db
    .select({
      seriesId: roomBookings.seriesId,
      date: roomBookings.date,
      room: roomBookings.room,
    })
    .from(roomBookings)
    .where(
      and(
        eq(roomBookings.status, "booked"),
        inArray(roomBookings.seriesId, seriesIds),
        inArray(roomBookings.date, dates)
      )
    )
}
