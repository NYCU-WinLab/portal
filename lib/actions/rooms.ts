import { Refusal } from "./define"
import { AsyncLocalStorage } from "node:async_hooks"

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
} from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import {
  createStandingMeeting,
  standingMeetingInput,
} from "@/lib/actions/rooms-series"
import { queueMail } from "@/lib/actions/mail"
import {
  bookingAgenda,
  cancelTeamsMeeting,
  joinUrl,
  meetingPending,
  meetingsOf,
  requestTeamsMeeting,
  rescheduleMeeting,
} from "@/lib/actions/rooms-meetings"
import type { QueuedMail } from "@/lib/mail"
import { mailBody } from "@/lib/mail-body"
import { db } from "@/lib/db"
import {
  appointments,
  bookingLeases,
  roomBookings,
  roomMeetingRequests,
  roomSeries,
  user,
} from "@/lib/db/schema"
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
  findLabReservations,
  release,
  reserve,
  Unanswered,
} from "@/lib/meetingroom"
import {
  daySlots,
  mergeRuns,
  pickRoom,
  type Busy,
  type Slot,
} from "@/lib/rooms/availability"
import {
  ADVISOR_USERNAME,
  DEFAULT_TOPIC,
  calendarInvite,
  cleanTopic,
  deliverablesOf,
  epicIid,
  externalMeetingLabel,
  externalMeetingUrl,
  mergeAttendees,
  plainTitle,
  topicPrefix,
  type Attendee,
} from "@/lib/rooms/meeting"
import {
  addDays,
  dayLabel,
  isCalendarDay,
  endMinutesOf,
  minutesOf,
  occurrencesBetween,
  ONLINE_AHEAD_DAYS,
  onlineSpanProblem,
  spanProblem,
  spansOverlap,
  taipeiIso,
  taipeiOffsetIso,
  todayInTaipei,
  weekdayOf,
} from "@/lib/rooms/time"

const day = z.string().refine(isCalendarDay, "日期要是 YYYY-MM-DD")
const time = z.string().regex(/^\d{2}:\d{2}$/, "時間要是 HH:MM")

/**
 * The department's free and busy rooms on each day, on the 30-minute grid.
 * except is a reservation of the lab's to count as open: the one a move
 * gives up, so the meeting can stay in its room.
 */
export async function availability(
  days: string[],
  fresh = false,
  except?: { room: string; start: string; end: string }
) {
  const rooms = await listRooms()
  const busy = await listBusy(
    rooms.filter((room) => room.active).map((room) => room.name),
    days,
    fresh
  )
  const ours = (b: Busy) =>
    except !== undefined &&
    b.room === except.room &&
    b.subscriber === labAccount() &&
    Date.parse(b.start) >= Date.parse(except.start) &&
    Date.parse(b.end) <= Date.parse(except.end)
  return days.map((date) => ({
    date,
    slots: daySlots(
      rooms,
      (busy.get(date) ?? []).filter((b) => !ours(b)),
      date,
      labAccount()
    ),
  }))
}

export const listRoomAvailability = defineAction({
  name: "list_room_availability",
  title: "教室空檔",
  description:
    "Free and busy time in the CS department's meeting rooms for up to 14 days from date (Asia/Taipei), read live from the department system, the grid 新增會議 on /meetings draws. Each run of the 30-minute grid lists the free-tier rooms open, the paid ones, and the rooms the lab's shared account already holds; lab_bookings says who booked those through the portal and what for. Every member gets the same answer. Book a slot with book_meeting.",
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
            title: plainTitle(b),
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
      externalUrl: roomBookings.externalUrl,
      status: roomBookings.status,
      title: roomBookings.title,
      meetingPrefix: roomBookings.meetingPrefix,
      agenda: roomBookings.agenda,
      groupName: roomBookings.groupName,
      attendees: roomBookings.attendees,
      seriesId: roomBookings.seriesId,
      seriesDate: roomBookings.seriesDate,
      labMeetingId: roomBookings.meetingId,
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
    title: plainTitle(row),
    meeting: row.online ? (meetings.get(row.id) ?? null) : null,
  }))
}

export const listMeetings = defineAction({
  name: "list_meetings",
  title: "會議",
  description:
    "Every meeting booked through the portal from date (default today, Asia/Taipei) for days days, the lab meeting's weekly Teams meeting included (lab_meeting_id set; its program is in list_lab_meetings): room (null for an online-only meeting), date, start and end, status booked or cancelled (cancelled rows stay), title, agenda, project group, attendees, who booked it, and the Teams meeting's state (pending, success with join_url, or failed with the reason). Every member sees every booking; only the member who booked one (or the member it was booked with through book_appointment) can cancel it with cancel_meeting.",
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

export const listProjectGroups = defineAction({
  name: "list_project_groups",
  title: "專案群組",
  description:
    "The lab's project groups in Keycloak (/winlab-projects), each with its slug name (the Teams topic prefix and what book_meeting's group takes), a label, whether it is linked to a GitLab group (only then can a meeting belong to an epic), the members who can be invited, and the names of members with no email.",
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
  if (!group) throw new Refusal(`沒有「${groupName}」這個專案群組`)
  if (!group.gitlabPath) throw new Refusal(`「${group.label}」沒有連到 GitLab`)
  return group.gitlabPath
}

export const listGroupEpics = defineAction({
  name: "list_group_epics",
  title: "群組 Epic",
  description:
    "The open GitLab epics of one project group (by its slug name from list_project_groups), most recently updated first: iid, title, description, url and kind. kind sync is a standing container (a series may only use these), meeting is one tracked meeting, report is a review over an iteration. Pass an iid as book_meeting's epic.",
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
  if (!groupName) throw new Refusal("要先選專案群組才能選 Epic")
  const path = await gitlabPathOf(groupName)
  const iid = epicIid(ref, path)
  if (iid === null) throw new Refusal("Epic 不屬於這個群組")
  const epic = await getEpic(path, iid)
  if (!epic) throw new Refusal(`Epic &${iid} 不存在`)
  if (forSeries && epic.kind !== "sync")
    throw new Refusal("固定會議只能選 Sync 類的 Epic")
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
    if (iid === null) throw new Refusal("Epic 不屬於這個群組")
    const found = await getEpic(path, iid)
    if (!found) throw new Refusal(`Epic &${iid} 不存在`)
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
    if (!group) throw new Refusal(`沒有「${input.group}」這個專案群組`)
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
  if (unknown.length) throw new Refusal(`找不到成員：${unknown.join("、")}`)
  if (input.includeAdvisor) {
    const advisor = everyone.find((m) => m.username === ADVISOR_USERNAME)
    if (!advisor) throw new Refusal("找不到老師的帳號")
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
  const external = method === "REQUEST" ? booking.externalUrl : null
  return {
    ics: calendarInvite({
      uid: `rooms-${booking.id}@portal.winlab.tw`,
      method,
      sequence: booking.inviteSequence,
      title: plainTitle(booking),
      location:
        booking.room || booking.place
          ? placeOf(booking)
          : (external ?? "線上會議"),
      start: taipeiIso(booking.date, booking.startTime),
      end: taipeiIso(booking.date, booking.endTime),
      organizer,
      attendees: booking.attendees,
      // A mailing list stands for the whole lab: replies would all land on
      // the organizer.
      rsvp: !booking.meetingId,
      joinUrl:
        booking.online && method === "REQUEST" ? joinUrl(booking.id) : null,
      externalUrl: external,
    }),
    icsMethod: method,
  }
}

const whenOf = (booking: Pick<Booking, "date" | "startTime" | "endTime">) =>
  `${dayLabel(booking.date)} ${booking.startTime} 到 ${booking.endTime}`

/** The invite (or cancellation) for a booking, to the organizer and every
 * attendee, with the calendar event attached. movedFrom, the booking
 * before a move, makes it the notice of the new time. */
function inviteMail(
  booking: Booking,
  organizer: { name: string; email: string },
  method: "REQUEST" | "CANCEL",
  movedFrom?: Booking
) {
  const when = whenOf(booking)
  const link =
    booking.online && method === "REQUEST" ? joinUrl(booking.id) : null
  // Someone else's meeting: people join it, and ours only records it.
  const external = method === "REQUEST" ? booking.externalUrl : null
  const to = mergeAttendees(
    [{ name: organizer.name, email: organizer.email }],
    booking.attendees
  ).map((a) => a.email)
  return {
    to,
    replyTo: organizer.email,
    subject: `[WinLab 會議] ${method === "CANCEL" ? "已取消" : movedFrom ? "改時間" : "邀請"}：${plainTitle(booking)}（${when}）`,
    ...mailBody({
      title:
        method === "CANCEL"
          ? `已取消：${plainTitle(booking)}`
          : plainTitle(booking),
      rows: [
        ["時間", when],
        ...(movedFrom
          ? ([["原本", whenOf(movedFrom)]] as [string, string][])
          : []),
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
        ...(external
          ? ([
              ["會議", externalMeetingLabel(external)],
              ...(link ? [["紀錄", "WinLab Meet 錄影與摘要"]] : []),
            ] as [string, string][])
          : []),
      ],
      paragraphs: booking.agenda ? [booking.agenda] : [],
      action: external
        ? { label: "加入會議", url: external }
        : link
          ? { label: "加入會議", url: link }
          : undefined,
      links:
        external && link ? [{ label: "開啟內部紀錄", url: link }] : undefined,
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
  /** The meeting people join when it is not ours; ours then records it. */
  externalUrl?: string | null
  meetingPrefix: string | null
  groupName: string | null
  agenda: string | null
  issueRefs: string[]
  deliverables: string[]
  seriesId?: string
  /** The Monday lab meeting this booking is for. */
  meetingId?: string
  place?: string
  /**
   * Replaces the usual invite, as the lab meeting's announcement does; null
   * mails nothing, for a booking whose invite goes out later.
   */
  invite?: (booking: Booking) => QueuedMail | null
  /** Runs first in the booking's transaction; throwing books nothing. */
  inTransaction?: (tx: Tx) => Promise<void>
}

/**
 * Reserves a room. When the system gives no clear answer, looks for the
 * lab's reservations of exactly that room and span and releases those no
 * portal booking holds. The caller holds the room's lease, so no other
 * portal booking of that room is half done, and an unclaimed one can only
 * be this attempt's.
 */
async function reserveOrClean(reservation: {
  room: string
  start: string
  end: string
}) {
  try {
    return await reserve(reservation)
  } catch (error) {
    if (!(error instanceof Unanswered)) throw error
  }
  // A slow system may still be writing it down.
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const found = await findLabReservations(reservation).catch(() => null)
  if (found === null)
    throw new Error(
      "系上借用系統沒有回應，也查不到有沒有借到，請到系上借用系統確認"
    )
  const claimed = found.length
    ? await db
        .select({ id: roomBookings.externalId })
        .from(roomBookings)
        .where(
          and(
            inArray(roomBookings.externalId, found),
            eq(roomBookings.status, "booked")
          )
        )
    : []
  const unclaimed = found.filter((id) => !claimed.some((row) => row.id === id))
  for (const id of unclaimed) await release(id, reservation)
  throw new Error(
    unclaimed.length
      ? "系上借用系統沒有回應，這次沒有借到教室，請再試一次"
      : "系上借用系統沒有回應，也沒找到借到的紀錄；它可能晚一點才記下，請先到系上借用系統確認再重試"
  )
}

/**
 * Reserves the room in the department system, records the booking with its
 * invite, then asks for the Teams meeting. A reservation the portal fails
 * to record is released again, so nothing is held that nobody can cancel.
 */
export async function placeBooking(input: NewBooking) {
  const start = taipeiIso(input.date, input.startTime)
  const end = taipeiIso(input.date, input.endTime)
  // The room's lease covers the reserve and the insert, so a clean-up after
  // an unanswered reserve never meets another booking of it half done.
  const record = async (externalId: string | null) => {
    try {
      return await db.transaction(async (tx) => {
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
            externalUrl: input.externalUrl ?? null,
            meetingPrefix: input.meetingPrefix,
            groupName: input.groupName,
            agenda: input.agenda,
            issueRefs: input.issueRefs,
            deliverables: input.deliverables,
            seriesId: input.seriesId,
            seriesDate: input.seriesId ? input.date : null,
            meetingId: input.meetingId,
            place: input.place,
            requestedBy: input.organizer.id,
          })
          .returning()
        const invite = input.invite
          ? input.invite(created)
          : inviteMail(created, input.organizer, "REQUEST")
        if (invite) await queueMail(tx, invite)
        return created
      })
    } catch (error) {
      if (externalId && input.room)
        await release(externalId, { room: input.room, start, end }).catch(
          () => {}
        )
      throw error
    }
  }
  const room = input.room
  const booking = room
    ? await withLease(`room ${room} ${input.date}`, async () =>
        record(await reserveOrClean({ room, start, end }))
      )
    : await record(null)
  await requestTeamsMeeting(booking)
  return booking
}

const heldLeases = new AsyncLocalStorage<Set<string>>()

/**
 * Runs fn holding the lease named key: taken by inserting a row (or
 * taking over one that ran out), so a caller that waits holds no
 * connection. Waits up to a minute; the lease runs out after 3 minutes if
 * its holder dies, longer than any reserve takes.
 */
export async function withLease<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  // Re-entrant: a caller already holding key (book_appointment holds both
  // members' locks before it books) runs fn straight away.
  const held = heldLeases.getStore()
  if (held?.has(key)) return fn()
  const token = crypto.randomUUID()
  for (let attempt = 0; ; attempt++) {
    const taken = await db
      .insert(bookingLeases)
      .values({ key, token, expiresAt: sql`now() + interval '3 minutes'` })
      .onConflictDoUpdate({
        target: bookingLeases.key,
        set: { token, expiresAt: sql`now() + interval '3 minutes'` },
        setWhere: sql`${bookingLeases.expiresAt} < now()`,
      })
      .returning({ key: bookingLeases.key })
    if (taken.length) break
    if (attempt >= 120)
      throw new Refusal("同一時段的另一筆預約還在處理，稍後再試")
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  try {
    return await heldLeases.run(new Set([...(held ?? []), key]), fn)
  } finally {
    await db
      .delete(bookingLeases)
      .where(and(eq(bookingLeases.key, key), eq(bookingLeases.token, token)))
      .catch(() => {})
  }
}

/**
 * Runs fn holding a lease on one member's bookings for one day, so a hand
 * booking and the standing meeting catch-up cannot both book the same slot
 * for them.
 */
export const withBookingLock = <T>(
  userId: string,
  date: string,
  fn: () => Promise<T>
) => withLease(`member ${userId} ${date}`, fn)

export async function organizerOf(userId: string) {
  const [me] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
    })
    .from(user)
    .where(eq(user.id, userId))
  if (!me) throw new Refusal("找不到你的帳號")
  return me
}

/** The room the page would pick for a span, or why there is none. */
export function roomFor(
  slots: Slot[],
  start: string,
  end: string,
  allowPaid: boolean,
  instead = "換個時段或改成線上",
  /** The room a move is in: kept when it is open for the whole span. */
  prefer?: string,
  /** The span fits inside what was already paid for in prefer. */
  paidFor = false
) {
  const picked = pickRoom(slots, start, end, prefer)
  if (!picked) throw new Refusal(`這段時間沒有教室從頭到尾都空著，${instead}`)
  if (picked.paid && !allowPaid && !(paidFor && picked.room === prefer))
    throw new Refusal(`只剩付費教室 ${picked.room}，同意付費才能借`)
  return picked
}

/**
 * Refuses an online meeting over one the member already has that day:
 * meetings they booked, and appointments labmates booked with them, since
 * both are theirs to attend. except leaves out the booking being moved.
 */
async function refuseClash(
  userId: string,
  date: string,
  start: string,
  end: string,
  except?: string
) {
  const mine = await db
    .select({
      id: roomBookings.id,
      title: roomBookings.title,
      meetingPrefix: roomBookings.meetingPrefix,
      start: roomBookings.startTime,
      end: roomBookings.endTime,
    })
    .from(roomBookings)
    .leftJoin(appointments, eq(appointments.bookingId, roomBookings.id))
    .where(
      and(
        or(
          eq(roomBookings.requestedBy, userId),
          eq(appointments.ownerId, userId)
        ),
        eq(roomBookings.date, date),
        eq(roomBookings.status, "booked")
      )
    )
  const clash = mine.find(
    (row) => row.id !== except && spansOverlap(row, { start, end })
  )
  if (clash)
    throw new Refusal(
      `你 ${clash.start} 到 ${clash.end} 已有「${plainTitle(clash)}」`
    )
}

export const bookMeeting = defineAction({
  name: "book_meeting",
  title: "新增會議",
  description:
    "Books a meeting as the member, 新增會議 on /meetings: a CS department room through the lab's shared account (the room /meetings would pick: open for the whole span, free before paid; a paid room only with allow_paid true, since the department charges for it), or no room with online_only. Every booking also gets a meet.winlab.tw room, recorded automatically with a transcript and meeting notes filed in GitLab, and every attendee and the member get a calendar invite by mail. Times are Asia/Taipei HH:MM on the 30-minute grid. A room booking runs between 08:00 and 22:00 (check list_room_availability first). An online_only meeting may be at any time from today to 90 days ahead, 30 to 300 minutes, ending by 24:00, and is refused when it overlaps another meeting the member booked or an appointment a labmate booked with them. attendees are portal user ids, emails or usernames; group is a project group's slug from list_project_groups, whose members are invited too unless invite_group_members is false, and which names the project the recording files under. epic (an iid from list_group_epics) needs a group linked to GitLab. include_advisor has no default because it mails the advisor. repeat weekly or biweekly makes it a standing meeting from date on instead (list_standing_meetings): each occurrence is booked 7 days ahead, with a room (free first, else paid) or, with online_only, only its meet.winlab.tw meeting; epic may then only be a sync epic, and the answer is the standing meeting's id, how many occurrences were booked at once and why others were not. Never book the Monday lab meeting here; the portal books it itself. Read back the date, time, room or online, title, attendees, advisor and the recording, and get the member's yes first.",
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
    external_url: z
      .string()
      .trim()
      .max(2000)
      .nullish()
      .describe(
        "the meeting people really join when it is someone else's, such as another company's Teams link (https); the invite then leads with it and keeps the meet room as the internal record"
      ),
    epic: z.string().trim().min(1).nullish(),
    repeat: z.enum(["none", "weekly", "biweekly"]).default("none"),
  }),
  run: async (actor, input) => {
    const externalUrl = externalMeetingUrl(input.external_url)
    const online = input.online_only
    const problem = online
      ? onlineSpanProblem(input.start_time, input.end_time)
      : spanProblem(input.start_time, input.end_time)
    if (problem) throw new Refusal(problem)
    if (input.date < todayInTaipei()) throw new Refusal("不能借過去的日期")
    if (online && input.date > addDays(todayInTaipei(), ONLINE_AHEAD_DAYS))
      throw new Refusal(`線上會議最多預約 ${ONLINE_AHEAD_DAYS} 天後`)
    if (input.repeat !== "none") {
      const standing = await createStandingMeeting(
        actor.userId,
        standingMeetingInput.parse({
          weekday: weekdayOf(input.date),
          start_date: input.date,
          start_time: input.start_time,
          // The span check passed, so both are on the grid; an online
          // one may end at "24:00".
          duration_minutes:
            endMinutesOf(input.end_time)! - minutesOf(input.start_time)!,
          interval_weeks: input.repeat === "weekly" ? 1 : 2,
          title: input.title,
          attendees: input.attendees,
          group: input.group,
          invite_group_members: input.invite_group_members,
          include_advisor: input.include_advisor,
          online_only: input.online_only,
          agenda: input.agenda,
          external_url: externalUrl,
          epic: input.epic,
        })
      )
      return { standing_meeting: standing.id, ...standing }
    }
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
    const organizer = await organizerOf(actor.userId)
    const prefix = topicPrefix(group, organizer.username)
    const { booking, room } = await withBookingLock(
      actor.userId,
      input.date,
      async () => {
        // A standing meeting of theirs may have just booked this span.
        const [standing] = await db
          .select({ id: roomBookings.id })
          .from(roomBookings)
          .where(
            and(
              eq(roomBookings.requestedBy, actor.userId),
              eq(roomBookings.date, input.date),
              eq(roomBookings.status, "booked"),
              isNotNull(roomBookings.seriesId),
              eq(roomBookings.startTime, input.start_time),
              eq(roomBookings.endTime, input.end_time)
            )
          )
        if (standing) throw new Refusal("你的固定會議已經借好這個時段了")
        if (input.online_only)
          await refuseClash(
            actor.userId,
            input.date,
            input.start_time,
            input.end_time
          )
        // Picked from a fresh read, not the grid the member clicked
        // minutes ago, and inside the lock.
        const room = input.online_only
          ? null
          : roomFor(
              (await availability([input.date], true))[0].slots,
              input.start_time,
              input.end_time,
              input.allow_paid
            )
        const booking = await placeBooking({
          date: input.date,
          startTime: input.start_time,
          endTime: input.end_time,
          room: room?.room ?? null,
          title: cleanTopic(input.title),
          attendees,
          organizer,
          // Every portal meeting gets a recording to look back at.
          online: true,
          externalUrl,
          meetingPrefix: prefix,
          groupName: group,
          agenda: input.agenda || null,
          ...epic,
        })
        return { booking, room }
      }
    )
    return {
      id: booking.id,
      room: booking.room,
      paid: room?.paid ?? false,
      title: plainTitle(booking),
      attendees: attendees.length,
    }
  },
})

export const getBookingAgenda = defineAction({
  name: "get_booking_agenda",
  title: "預約議程",
  description:
    "The agenda of an online booking as meet shows it, by the meet booking id (room-booking-…, the create request's id): status booked or cancelled, title, project group, startsAt and endsAt (Asia/Taipei offset), the epic reference, and items: the booking's agenda lines (source booking), then the epic's open child issues with their url (source issue), at most 30. gitlab is unavailable when GitLab did not answer and only the booking's lines are listed. meet calls this when the room opens; any member may read it.",
  kind: "query",
  input: z.object({
    booking: z
      .string()
      .regex(/^room-booking-(?:[0-9a-f]){12}$/, "預約編號格式不對"),
  }),
  run: async (_actor, input) => {
    const [row] = await db
      .select({ booking: roomBookings })
      .from(roomMeetingRequests)
      .innerJoin(
        roomBookings,
        eq(roomBookings.id, roomMeetingRequests.bookingId)
      )
      .where(
        and(
          eq(roomMeetingRequests.requestId, input.booking),
          eq(roomMeetingRequests.kind, "create")
        )
      )
    if (!row) throw new Refusal("沒有這個預約")
    const { booking } = row
    const { items, gitlab } = await bookingAgenda(booking)
    return {
      booking: input.booking,
      status: booking.status === "booked" ? "booked" : "cancelled",
      title: plainTitle(booking),
      group: booking.groupName,
      startsAt: taipeiOffsetIso(booking.date, booking.startTime),
      endsAt: taipeiOffsetIso(booking.date, booking.endTime),
      epic: booking.issueRefs[0] ?? null,
      items,
      gitlab,
    }
  },
})

export const listInvitedBookings = defineAction({
  name: "list_invited_bookings",
  title: "受邀的線上會議",
  description:
    "The meet booking ids (room-booking-…, the create request's id) of the online bookings meet made a room for that list a member, by username, among their attendees, newest first, at most 500. An attendee saved without a username (the advisor) matches by the member's email. meet calls this so an invited member can open the meeting's recording even when they never joined the room. Every member sees every booking's attendees in list_meetings, so any member may read it.",
  kind: "query",
  input: z.object({ username: z.string().trim().min(1).max(64) }),
  run: async (_actor, { username }) => {
    const [member] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.username, username))
    const invited = [
      sql`${roomBookings.attendees} @> ${JSON.stringify([{ username }])}::jsonb`,
      ...(member?.email
        ? [
            sql`${roomBookings.attendees} @> ${JSON.stringify([{ email: member.email }])}::jsonb`,
          ]
        : []),
    ]
    const rows = await db
      .select({ booking: roomMeetingRequests.requestId })
      .from(roomMeetingRequests)
      .innerJoin(
        roomBookings,
        eq(roomBookings.id, roomMeetingRequests.bookingId)
      )
      .where(
        and(
          eq(roomMeetingRequests.kind, "create"),
          // Only rooms meet made: not Teams requests, not failed tries.
          eq(roomMeetingRequests.status, "success"),
          eq(roomMeetingRequests.messageId, "meet"),
          or(...invited)
        )
      )
      .orderBy(desc(roomBookings.date), desc(roomBookings.startTime))
      .limit(500)
    return { bookings: rows.map((row) => row.booking) }
  },
})

export const cancelMeeting = defineAction({
  name: "cancel_meeting",
  title: "取消會議",
  description:
    "Cancels one of the member's own bookings (by id from list_meetings), or a meeting a labmate booked with them through book_appointment: releases the department room, takes down its Teams meeting and mails everyone the cancellation. Only the member who booked it or, for an appointment, the member booked; fails on someone else's or one already cancelled. teams_error is set when the Teams meeting could not be taken down: it will still start and record unless someone deletes it in Teams.",
  kind: "mutation",
  input: z.object({ id: z.uuid("id 是預約的 id") }),
  run: async (actor, { id }) => {
    const [booking] = await db
      .select()
      .from(roomBookings)
      .where(and(eq(roomBookings.id, id), eq(roomBookings.status, "booked")))
    if (!booking) throw new Refusal("找不到這筆預約，或已經取消")
    if (booking.requestedBy !== actor.userId) {
      // The member booked through their appointment schedule may cancel too.
      const [appointment] = await db
        .select({ ownerId: appointments.ownerId })
        .from(appointments)
        .where(eq(appointments.bookingId, booking.id))
      if (appointment?.ownerId !== actor.userId)
        throw new Refusal("只能取消自己的預約")
    }
    if (booking.meetingId)
      throw new Refusal(
        "這是週一 Lab Meeting 的會議，請到 /meetings 請管理員改"
      )
    return cancelBooking(booking, actor.userId)
  },
})

export const moveMeeting = defineAction({
  name: "move_meeting",
  title: "改會議時間",
  description:
    "Moves one of the member's own one-off bookings (by id from list_meetings) to another date or time, keeping its title, attendees, agenda, links and meet.winlab.tw room. A room booking stays in its room when that room is open for the new span, its own reservation counted as open (on the same day the old span is released first and taken back if the new one is refused); otherwise it gets the room /meetings would pick (free before paid) and keeps 08:00 to 22:00. A paid room needs allow_paid true, also to keep a paid room for longer or at another time, but not for less of the same span; an online-only one keeps its own limits (today to 90 days ahead, 30 to 300 minutes, no overlap with the member's other meetings). A refused move changes nothing; if the old span cannot be taken back either, the move fails saying so, and the booking keeps its time without a room (everyone gets that invite). Everyone gets the updated calendar invite by mail. One week of a standing meeting moves the same way, that week only, but not onto a day the series meets on: the series keeps its day and time, and the daily run never books the old day again. Only the member who booked it; not for the Monday lab meeting or an appointment booked through book_appointment (cancel and book again). room_error is set when the old department room could not be released: release it by hand in the department system. meet_error is set when meet kept the old time. Read back the new date, time and room, and get the member's yes first.",
  kind: "mutation",
  input: z.object({
    id: z.uuid("id 是預約的 id"),
    date: day,
    start_time: time,
    end_time: time,
    allow_paid: z.boolean().default(false),
  }),
  // One move or cancel of a booking at a time: each reads the row, works
  // the department system and meet, then writes, and an interleaving
  // would leave a room held or meet on an older time.
  run: (actor, input) =>
    withLease(`booking ${input.id}`, async () => {
      const [booking] = await db
        .select()
        .from(roomBookings)
        .where(
          and(eq(roomBookings.id, input.id), eq(roomBookings.status, "booked"))
        )
      if (!booking) throw new Refusal("找不到這筆預約，或已經取消")
      if (booking.requestedBy !== actor.userId)
        throw new Refusal("只有發起人能改時間")
      if (booking.meetingId)
        throw new Refusal("週一 Lab Meeting 請到 /meetings 由報告人或管理員改")
      const [appointment] = await db
        .select({ bookingId: appointments.bookingId })
        .from(appointments)
        .where(eq(appointments.bookingId, booking.id))
      if (appointment)
        throw new Refusal("透過預約時段約的會議不能改時間，請取消後重新預約")
      const today = todayInTaipei()
      if (booking.date < today) throw new Refusal("過去的會議不能改時間")
      // A week moved onto a day its series meets on would sit beside that
      // day's own week, and the daily run would hold a second room.
      if (booking.seriesId && input.date !== booking.seriesDate) {
        const [series] = await db
          .select()
          .from(roomSeries)
          .where(eq(roomSeries.id, booking.seriesId))
        if (series && occurrencesBetween(series, input.date, input.date).length)
          throw new Refusal("那天本來就有這個固定會議，請改到別天")
      }
      if (
        booking.date === input.date &&
        booking.startTime === input.start_time &&
        booking.endTime === input.end_time
      )
        throw new Refusal("時間沒有變")
      const hasRoom = Boolean(booking.room)
      const problem = hasRoom
        ? spanProblem(input.start_time, input.end_time)
        : onlineSpanProblem(input.start_time, input.end_time)
      if (problem) throw new Refusal(problem)
      if (input.date < today) throw new Refusal("不能改到過去的日期")
      if (!hasRoom && input.date > addDays(today, ONLINE_AHEAD_DAYS))
        throw new Refusal(`線上會議最多預約 ${ONLINE_AHEAD_DAYS} 天後`)
      if (hasRoom && !bookingConfigured())
        throw new Error("Portal 還沒設定系上借用帳號，現在不能改教室時段")
      if (await meetingPending(booking.id))
        throw new Refusal("線上會議室還在建立，稍後再改")
      const organizer = await organizerOf(actor.userId)

      // The department reservation the booking holds now.
      const old =
        booking.externalId && booking.room
          ? {
              id: booking.externalId,
              span: {
                room: booking.room,
                start: taipeiIso(booking.date, booking.startTime),
                end: taipeiIso(booking.date, booking.endTime),
              },
            }
          : null
      const { moved, paid, released } = await withBookingLock(
        actor.userId,
        input.date,
        async () => {
          if (!hasRoom)
            await refuseClash(
              actor.userId,
              input.date,
              input.start_time,
              input.end_time,
              booking.id
            )
          // Picked from a fresh read, inside the lock, as a new booking is,
          // counting the room it gives up as open: it stays there when it
          // can.
          const room = hasRoom
            ? roomFor(
                (await availability([input.date], true, old?.span))[0].slots,
                input.start_time,
                input.end_time,
                input.allow_paid,
                "換個時段",
                booking.room ?? undefined,
                // Paying for more of the room is asked again; less is not.
                input.date === booking.date &&
                  input.start_time >= booking.startTime &&
                  input.end_time <= booking.endTime
              )
            : null
          const save = (externalId: string | null) =>
            db.transaction(async (tx) => {
              const [row] = await tx
                .update(roomBookings)
                .set({
                  date: input.date,
                  startTime: input.start_time,
                  endTime: input.end_time,
                  room: room?.room ?? null,
                  externalId,
                  // A newer sequence, or calendars keep the old time.
                  inviteSequence: sql`${roomBookings.inviteSequence} + 1`,
                })
                // A cancel or another move since the read above leaves the
                // row alone.
                .where(
                  and(
                    eq(roomBookings.id, booking.id),
                    eq(roomBookings.status, "booked"),
                    eq(roomBookings.date, booking.date),
                    eq(roomBookings.startTime, booking.startTime),
                    eq(roomBookings.endTime, booking.endTime)
                  )
                )
                .returning()
              if (!row)
                throw new Refusal("這筆預約剛被取消或改過，重新整理再試")
              await queueMail(
                tx,
                inviteMail(row, organizer, "REQUEST", booking)
              )
              return row
            })
          if (!room)
            return { moved: await save(null), paid: false, released: false }
          const reservation = {
            room: room.room,
            start: taipeiIso(input.date, input.start_time),
            end: taipeiIso(input.date, input.end_time),
          }
          // Same room, overlapping span: the department system cannot hold
          // both, and has no edit, so the old one goes first. Its span is
          // taken back when the new one is refused.
          if (
            old &&
            room.room === old.span.room &&
            input.date === booking.date &&
            spansOverlap(
              { start: booking.startTime, end: booking.endTime },
              { start: input.start_time, end: input.end_time }
            )
          ) {
            const restore = async () => {
              const back = await reserveOrClean(old.span).catch(() => null)
              if (back) {
                await db
                  .update(roomBookings)
                  .set({ externalId: back })
                  .where(eq(roomBookings.id, booking.id))
                return
              }
              // Nothing holds the room now: the booking keeps its time
              // without a room, and everyone gets the invite that says so.
              await db.transaction(async (tx) => {
                const [row] = await tx
                  .update(roomBookings)
                  .set({
                    room: null,
                    externalId: null,
                    inviteSequence: sql`${roomBookings.inviteSequence} + 1`,
                  })
                  .where(eq(roomBookings.id, booking.id))
                  .returning()
                if (row)
                  await queueMail(
                    tx,
                    inviteMail(row, organizer, "REQUEST", booking)
                  )
              })
              throw new Error(
                `${old.span.room} 退掉後借不回來，這場目前沒有教室，請重新借教室或改成線上`
              )
            }
            // A release with no clear answer may still have gone through:
            // the room's reservations say which.
            const releaseOld = async () => {
              try {
                await release(old.id, old.span)
              } catch (error) {
                const left = await findLabReservations(old.span).catch(
                  () => null
                )
                if (left === null)
                  throw new Error(
                    `系上借用系統沒有回應，請到系上借用系統確認 ${old.span.room} 還在不在`
                  )
                if (left.includes(old.id)) throw error
              }
            }
            const moved = await withLease(
              `room ${room.room} ${input.date}`,
              async () => {
                await releaseOld()
                let externalId: string
                try {
                  externalId = await reserveOrClean(reservation)
                } catch (error) {
                  await restore()
                  throw error
                }
                try {
                  return await save(externalId)
                } catch (error) {
                  await release(externalId, reservation).catch(() => {})
                  await restore()
                  throw error
                }
              }
            )
            return { moved, paid: room.paid, released: true }
          }
          const moved = await withLease(
            `room ${room.room} ${input.date}`,
            async () => {
              const externalId = await reserveOrClean(reservation)
              try {
                return await save(externalId)
              } catch (error) {
                await release(externalId, reservation).catch(() => {})
                throw error
              }
            }
          )
          return { moved, paid: room.paid, released: false }
        }
      )

      // The new room is held and recorded; only now let the old one go.
      let roomError: string | null = null
      if (old && !released)
        try {
          await release(old.id, old.span)
        } catch {
          roomError = `${dayLabel(booking.date)} ${booking.startTime} 的 ${booking.room} 沒退掉，請到系上借用系統取消`
        }
      const meetError = await rescheduleMeeting(moved.id)
      return {
        id: moved.id,
        date: moved.date,
        start_time: moved.startTime,
        end_time: moved.endTime,
        room: moved.room,
        paid,
        room_error: roomError,
        meet_error: meetError,
      }
    }),
})

/**
 * Marks a booking cancelled inside the caller's transaction, mailing
 * everyone the cancellation when notify. Returns the row, or null when it
 * was no longer booked. Its Teams meeting is taken down after the commit
 * (cancelTeamsMeeting); a take-down that never happens is retried by the
 * scheduler (reconcileTeams), since the row already says cancelled.
 */
export async function markCancelled(
  tx: Tx,
  booking: Booking,
  cancelledBy: string,
  notify: boolean
) {
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
  if (!row) return null
  if (notify)
    await queueMail(
      tx,
      inviteMail(row, await organizerOf(booking.requestedBy), "CANCEL")
    )
  return row
}

/**
 * Cancels a booking: releases its department room, mails everyone the
 * cancellation and takes down its Teams meeting. teams_error says why the
 * Teams meeting could not be taken down. notify false skips the mail, for a
 * booking whose invite never went out.
 */
export async function cancelBooking(
  read: Booking,
  cancelledBy: string,
  { notify = true } = {}
) {
  // Under the booking's lease, as move_meeting is, and from a fresh read:
  // a move since the caller read it holds another room.
  return withLease(`booking ${read.id}`, async () => {
    const [booking] = await db
      .select()
      .from(roomBookings)
      .where(eq(roomBookings.id, read.id))
    if (!booking || booking.status !== "booked")
      throw new Refusal("這筆預約已經取消")
    if (booking.externalId && booking.room)
      await release(booking.externalId, {
        room: booking.room,
        start: taipeiIso(booking.date, booking.startTime),
        end: taipeiIso(booking.date, booking.endTime),
      })
    const cancelled = await db.transaction(async (tx) => {
      const row = await markCancelled(tx, booking, cancelledBy, notify)
      if (!row) throw new Refusal("這筆預約已經取消")
      // A move that outlived the lease holds another room now: keep the
      // booking, rather than cancel it with that room still held.
      if (row.externalId !== booking.externalId)
        throw new Refusal("這筆預約剛改過時間，重新整理再試")
      return row
    })
    const teamsError = await cancelTeamsMeeting(cancelled)
    return { cancelled: true, teams_error: teamsError }
  })
}

/**
 * Every booking, kept or cancelled, that settles a week of these series
 * from today on: the week it stands for (seriesDate) and when it is held,
 * which differ once the week was moved.
 */
export async function seriesBookings(seriesIds: string[]) {
  if (!seriesIds.length) return []
  return db
    .select({
      seriesId: roomBookings.seriesId,
      seriesDate: roomBookings.seriesDate,
      date: roomBookings.date,
      startTime: roomBookings.startTime,
      endTime: roomBookings.endTime,
      room: roomBookings.room,
      status: roomBookings.status,
    })
    .from(roomBookings)
    .where(
      and(
        inArray(roomBookings.seriesId, seriesIds),
        gte(roomBookings.seriesDate, todayInTaipei())
      )
    )
}
