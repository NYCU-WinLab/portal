import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"
import { roomBookings } from "@/lib/db/rooms"

// A member's Google Calendar, linked so the lab can see when they are busy.
// visibility private shows others only busy blocks; public shows each
// event's title and location too. The refresh token is sealed with
// CALENDAR_SECRET (lib/calendar-crypto.ts), never stored in the clear.
export const calendarLinks = pgTable(
  "calendar_links",
  {
    userId: uuid()
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    googleEmail: text().notNull(),
    refreshToken: text().notNull(),
    visibility: text().notNull().default("private"),
    syncedAt: timestamp({ withTimezone: true }),
    syncError: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "calendar_links_visibility",
      sql`${table.visibility} in ('private', 'public')`
    ),
  ]
)

// The linked calendar's events in the synced window, replaced on each sync.
// private marks an event the owner set to private in Google: it shows as
// busy even on a public calendar.
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => calendarLinks.userId, { onDelete: "cascade" }),
    googleId: text().notNull(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    allDay: boolean().notNull(),
    title: text().notNull(),
    location: text().notNull(),
    private: boolean().notNull(),
  },
  (table) => [
    unique().on(table.userId, table.googleId),
    index().on(table.userId, table.startsAt),
  ]
)

// Each member's subscription links carry a key derived from this version;
// raising it makes every link they handed out stop working.
export const calendarFeeds = pgTable("calendar_feeds", {
  userId: uuid()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  version: integer().notNull().default(1),
})

// When labmates may book a meeting with this member: weekly windows in
// Asia/Taipei (weekday 0 = Sunday, HH:MM on the 30-minute grid), cut into
// slots of slotMinutes, up to aheadDays ahead. A slot is offered only while
// the member's calendar and portal meetings leave it free.
export type AppointmentWindow = { weekday: number; start: string; end: string }

export const appointmentSchedules = pgTable(
  "appointment_schedules",
  {
    userId: uuid()
      .primaryKey()
      .references(() => calendarLinks.userId, { onDelete: "cascade" }),
    windows: jsonb().$type<AppointmentWindow[]>().notNull(),
    slotMinutes: integer().notNull().default(30),
    aheadDays: integer().notNull().default(14),
  },
  (table) => [
    check("appointment_schedules_slot", sql`${table.slotMinutes} in (30, 60)`),
    check(
      "appointment_schedules_ahead",
      sql`${table.aheadDays} between 1 and 60`
    ),
  ]
)

// A portal meeting booked through someone's appointment schedule: the booker
// organizes it, and the member booked (ownerId) may cancel it too.
export const appointments = pgTable(
  "appointments",
  {
    bookingId: uuid()
      .primaryKey()
      .references(() => roomBookings.id, { onDelete: "cascade" }),
    ownerId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index().on(table.ownerId)]
)
