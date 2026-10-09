// What the meetings actions share: who may present or ask (from Keycloak),
// the schedule as members read it, and the questioner assignment that runs
// after every change to the schedule or the presenter list.
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  account,
  meetingQuestioners,
  meetings,
  papers,
  presenters,
  user,
} from "@/lib/db/schema"
import { type LabMember, labDirectory } from "@/lib/keycloak"
import { taipeiToday } from "@/lib/leave-dates"
import { semesterOf } from "@/lib/semester"

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export const QUESTIONERS_PER_WEEK = 3

/** Doctoral students present before master's students. */
const statusRank = { doctoral: 0, master: 1 } as const

/** Keycloak status and cohort of each member, by portal user id. */
export async function labMembersByUser(
  userIds: string[]
): Promise<Map<string, LabMember>> {
  if (userIds.length === 0) return new Map()
  const [links, directory] = await Promise.all([
    db
      .select({ userId: account.userId, sub: account.accountId })
      .from(account)
      .where(
        and(
          inArray(account.userId, userIds),
          eq(account.providerId, "keycloak")
        )
      ),
    labDirectory(),
  ])
  return new Map(
    links.map(({ userId, sub }) => [userId, directory.get(sub) ?? {}])
  )
}

/** Doctoral or master's: the only members who present and ask. */
export const inRotation = (member?: LabMember) =>
  member?.status === "doctoral" || member?.status === "master"

/** The presenter list in turn order, with each member's Keycloak status. */
export async function presenterRoster(tx: Tx | typeof db = db) {
  const rows = await tx
    .select({
      userId: presenters.userId,
      position: presenters.position,
      name: user.name,
    })
    .from(presenters)
    .innerJoin(user, eq(user.id, presenters.userId))
  const lab = await labMembersByUser(rows.map((row) => row.userId))
  return rows
    .map((row) => {
      const member = lab.get(row.userId)
      return {
        ...row,
        status: member?.status ?? null,
        cohort: member?.cohort ?? null,
        inRotation: inRotation(member),
      }
    })
    .sort(
      (a, b) =>
        Number(!a.inRotation) - Number(!b.inRotation) ||
        (statusRank[a.status as keyof typeof statusRank] ?? 9) -
          (statusRank[b.status as keyof typeof statusRank] ?? 9) ||
        (a.cohort ?? 999) - (b.cohort ?? 999) ||
        a.position - b.position ||
        a.userId.localeCompare(b.userId)
    )
}

/** A week with a member presenting gets questioners; others do not. */
const takesQuestioners = (row: { kind: string; presenterId: string | null }) =>
  (row.kind === "regular" || row.kind === "thesis") && row.presenterId !== null

/**
 * Fills questioner seats from today on. Rules, in order:
 * 1. A manual seat (an admin's pick) never moves.
 * 2. The nearest meeting keeps its seats; only empty ones are filled.
 * 3. Later weeks are worked out again from scratch.
 * 4. Nobody asks in their own week, or two meetings in a row.
 * 5. Whoever has asked least this semester goes first; ties go to whoever
 *    asked longest ago, then a fixed order.
 */
export async function assignQuestioners(tx: Tx) {
  const today = taipeiToday()
  const schedule = await tx
    .select({
      id: meetings.id,
      date: meetings.date,
      kind: meetings.kind,
      presenterId: meetings.presenterId,
    })
    .from(meetings)
    .orderBy(asc(meetings.date))
  const roster = (await presenterRoster(tx)).filter((row) => row.inRotation)
  const pool = roster.map((row) => row.userId)

  const seatRows = await tx
    .select({
      meetingId: meetingQuestioners.meetingId,
      userId: meetingQuestioners.userId,
      manual: meetingQuestioners.manual,
    })
    .from(meetingQuestioners)
  const seats = new Map<string, { userId: string; manual: boolean }[]>()
  for (const { meetingId, ...seat } of seatRows)
    seats.set(meetingId, [...(seats.get(meetingId) ?? []), seat])

  const asking = schedule.filter(takesQuestioners)
  const nearest = asking.find((row) => row.date >= today)

  // Seats that no longer fit: weeks without questioners, a presenter
  // asking in their own week, and automatic seats after the nearest week.
  for (const row of schedule) {
    if (row.date < today) continue
    const kept = (seats.get(row.id) ?? []).filter(
      (seat) =>
        takesQuestioners(row) &&
        seat.userId !== row.presenterId &&
        (seat.manual || row.id === nearest?.id)
    )
    seats.set(row.id, kept)
  }
  await tx.delete(meetingQuestioners).where(
    inArray(
      meetingQuestioners.meetingId,
      schedule.filter((row) => row.date >= today).map((row) => row.id)
    )
  )

  const counts = new Map<string, number>()
  const lastAsked = new Map<string, string>()
  let semester = ""
  let previous: string[] = []
  for (const row of asking) {
    const { start } = semesterOf(row.date)
    if (start !== semester) {
      semester = start
      counts.clear()
    }
    const weekSeats = seats.get(row.id) ?? []
    if (row.date >= today) {
      const taken = new Set(weekSeats.map((seat) => seat.userId))
      const candidates = pool
        .filter(
          (userId) =>
            userId !== row.presenterId &&
            !taken.has(userId) &&
            !previous.includes(userId)
        )
        .sort(
          (a, b) =>
            (counts.get(a) ?? 0) - (counts.get(b) ?? 0) ||
            (lastAsked.get(a) ?? "").localeCompare(lastAsked.get(b) ?? "") ||
            pool.indexOf(a) - pool.indexOf(b)
        )
      for (const userId of candidates.slice(
        0,
        Math.max(0, QUESTIONERS_PER_WEEK - weekSeats.length)
      ))
        weekSeats.push({ userId, manual: false })
      seats.set(row.id, weekSeats)
    }
    for (const seat of weekSeats) {
      counts.set(seat.userId, (counts.get(seat.userId) ?? 0) + 1)
      lastAsked.set(seat.userId, row.date)
    }
    previous = weekSeats.map((seat) => seat.userId)
  }

  const inserts = schedule
    .filter((row) => row.date >= today)
    .flatMap((row) =>
      (seats.get(row.id) ?? []).map((seat) => ({
        meetingId: row.id,
        userId: seat.userId,
        manual: seat.manual,
      }))
    )
  if (inserts.length) await tx.insert(meetingQuestioners).values(inserts)
}

/**
 * Runs a change to the schedule or the presenter list, then reassigns
 * questioners, all in one transaction. One change at a time: the lock keeps
 * two assignments from racing.
 */
export async function changeSchedule<T>(change: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('meetings'))`)
    const result = await change(tx)
    await assignQuestioners(tx)
    return result
  })
}

/** The whole schedule as members read it, soonest first. */
export async function readSchedule(where?: { fromDate?: string }) {
  const rows = await db
    .select({
      id: meetings.id,
      date: meetings.date,
      label: meetings.label,
      kind: meetings.kind,
      holiday: meetings.holiday,
      presenterId: meetings.presenterId,
      presenterName: user.name,
      paperId: meetings.paperId,
      paperTitle: papers.title,
      paperUrl: papers.url,
      paperVenue: papers.venue,
      title: meetings.title,
      slidesUrl: meetings.slidesUrl,
      recordingUrl: meetings.recordingUrl,
      notes: meetings.notes,
      location: meetings.location,
      startsAt: meetings.startsAt,
    })
    .from(meetings)
    .leftJoin(user, eq(user.id, meetings.presenterId))
    .leftJoin(papers, eq(papers.id, meetings.paperId))
    .where(where?.fromDate ? gt(meetings.date, where.fromDate) : undefined)
    .orderBy(asc(meetings.date))
  const questioners = await db
    .select({
      meetingId: meetingQuestioners.meetingId,
      userId: meetingQuestioners.userId,
      name: user.name,
      manual: meetingQuestioners.manual,
    })
    .from(meetingQuestioners)
    .innerJoin(user, eq(user.id, meetingQuestioners.userId))
    .orderBy(asc(user.name))
  return rows.map((row) => ({
    date: row.date,
    label: row.label,
    semester: semesterOf(row.date).label,
    kind: row.kind,
    holiday: row.holiday,
    presenter: row.presenterId
      ? { id: row.presenterId, name: row.presenterName ?? "" }
      : null,
    paper: row.paperId
      ? {
          id: row.paperId,
          title: row.paperTitle ?? "",
          url: row.paperUrl,
          venue: row.paperVenue,
        }
      : null,
    title: row.paperTitle ?? row.title,
    slidesUrl: row.slidesUrl,
    recordingUrl: row.recordingUrl,
    notes: row.notes,
    location: row.location,
    startsAt: row.startsAt.slice(0, 5),
    questioners: questioners
      .filter((seat) => seat.meetingId === row.id)
      .map(({ userId, name, manual }) => ({ id: userId, name, manual })),
  }))
}

export type ScheduledMeeting = Awaited<ReturnType<typeof readSchedule>>[number]

/** The meeting on date, or an error members can read. */
export async function meetingOn(tx: Tx, date: string) {
  const [row] = await tx
    .select()
    .from(meetings)
    .where(eq(meetings.date, date))
    .for("update")
  if (!row) throw new Error(`${date} 沒有排會議`)
  return row
}
