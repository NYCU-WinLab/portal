import { and, eq, gte, isNotNull, lte, or, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { appointments, roomBookings, user } from "@/lib/db/schema"
import type { GoogleEvent } from "@/lib/google-calendar"
import { projectGroups } from "@/lib/keycloak"
import { meetAction, meetConfigured } from "@/lib/meet"
import { emitErrorLog } from "@/lib/otel"
import { plainTitle } from "@/lib/rooms/meeting"
import { taipeiIso } from "@/lib/rooms/time"

// The meetings a member takes part in, as their portal calendar's "WinLab
// 會議" source: portal bookings they made, are invited to, that belong to
// one of their project groups, booked with them (appointments), and the
// weekly lab meeting; plus rooms scheduled straight in meet for one of
// their groups or by them. Every member sees every portal meeting
// (list_meetings), so nothing here is more private than that list.

const day = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)

type ScheduledRoom = {
  name: string
  title: string
  prefix: string
  booking: string | null
  startsAt: string
  endsAt: string
}

/** Rooms scheduled in meet that no portal booking holds. */
async function meetRooms(): Promise<ScheduledRoom[]> {
  if (!meetConfigured()) return []
  try {
    const answer = await meetAction<{ scheduled?: ScheduledRoom[] }>(
      "list_rooms",
      {}
    )
    return (answer.scheduled ?? []).filter((room) => !room.booking)
  } catch (error) {
    // Portal meetings still show; meet's own rooms come back next sync.
    emitErrorLog(error, { "calendar.source_kind": "portal" })
    return []
  }
}

export async function portalMeetings(
  userId: string,
  from: Date,
  to: Date
): Promise<GoogleEvent[]> {
  const [me] = await db
    .select({ email: user.email, username: user.username })
    .from(user)
    .where(eq(user.id, userId))
  if (!me) return []
  const email = me.email.toLowerCase()
  // A Keycloak failure throws: the source keeps its last copy and says so,
  // rather than showing the member free in their group's meetings.
  const groups = (await projectGroups())
    .filter((group) =>
      group.members.some((member) => member.email.toLowerCase() === email)
    )
    .map((group) => group.name)

  const rows = await db
    .select({
      id: roomBookings.id,
      date: roomBookings.date,
      start: roomBookings.startTime,
      end: roomBookings.endTime,
      title: roomBookings.title,
      meetingPrefix: roomBookings.meetingPrefix,
      room: roomBookings.room,
      place: roomBookings.place,
    })
    .from(roomBookings)
    .leftJoin(appointments, eq(appointments.bookingId, roomBookings.id))
    .where(
      and(
        eq(roomBookings.status, "booked"),
        gte(roomBookings.date, day(from)),
        lte(roomBookings.date, day(to)),
        or(
          eq(roomBookings.requestedBy, userId),
          eq(appointments.ownerId, userId),
          isNotNull(roomBookings.meetingId),
          sql`exists (select 1 from jsonb_array_elements(${roomBookings.attendees}) a where lower(a->>'email') = ${email})`,
          ...(groups.length
            ? [
                sql`${roomBookings.groupName} in (${sql.join(
                  groups.map((name) => sql`${name}`),
                  sql`, `
                )})`,
              ]
            : [])
        )
      )
    )

  const events: GoogleEvent[] = rows.map((row) => ({
    googleId: `booking:${row.id}`,
    startsAt: new Date(taipeiIso(row.date, row.start)),
    endsAt: new Date(taipeiIso(row.date, row.end)),
    allDay: false,
    title: plainTitle(row).slice(0, 300),
    location: row.room ?? row.place ?? "線上",
    private: false,
  }))

  const mine = new Set([...groups, ...(me.username ? [me.username] : [])])
  for (const room of await meetRooms()) {
    if (!mine.has(room.prefix)) continue
    const startsAt = new Date(room.startsAt)
    const endsAt = new Date(room.endsAt)
    if (endsAt <= from || startsAt >= to) continue
    events.push({
      googleId: `meet:${room.name}`,
      startsAt,
      endsAt,
      allDay: false,
      title: room.title.slice(0, 300),
      location: "線上",
      private: false,
    })
  }
  return events
}
