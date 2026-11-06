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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"
import { roomBookings } from "@/lib/db/rooms"

// A member's Google account, linked so the portal can read the calendars
// it holds (calendar_sources of kind google). The refresh token is sealed
// with CALENDAR_SECRET (lib/calendar-crypto.ts), never stored in the clear.
// scopes are the ones Google granted: without the calendar list scope only
// the primary calendar can be read.
export const calendarLinks = pgTable("calendar_links", {
  userId: uuid()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  googleEmail: text().notNull(),
  refreshToken: text().notNull(),
  scopes: text().notNull().default(""),
  syncedAt: timestamp({ withTimezone: true }),
  syncError: text(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

// One calendar that makes up a member's portal calendar: a Google calendar
// of their linked account (googleCalendarId, read as events or, with only
// free/busy access, as busy blocks), a subscribed ICS address (url, sealed:
// such links are often secret), an imported ICS file (content), or the
// portal's own meetings they take part in (kind portal, one per member). Only
// enabled sources count; each one's visibility says what others see:
// private shows busy blocks, public also each event's title and location.
export const calendarSources = pgTable(
  "calendar_sources",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    label: text().notNull(),
    googleCalendarId: text(),
    accessRole: text(),
    primary: boolean().notNull().default(false),
    url: text(),
    content: text(),
    enabled: boolean().notNull().default(false),
    visibility: text().notNull().default("private"),
    syncedAt: timestamp({ withTimezone: true }),
    syncError: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique().on(table.userId, table.googleCalendarId),
    uniqueIndex("calendar_sources_one_portal")
      .on(table.userId)
      .where(sql`${table.kind} = 'portal'`),
    index().on(table.userId),
    check(
      "calendar_sources_kind",
      sql`(${table.kind} = 'google' and ${table.googleCalendarId} is not null)
        or (${table.kind} = 'ics' and ${table.url} is not null)
        or (${table.kind} = 'file' and ${table.content} is not null)
        or ${table.kind} = 'portal'`
    ),
    check(
      "calendar_sources_visibility",
      sql`${table.visibility} in ('private', 'public')`
    ),
  ]
)

// The events of each source in the synced window, replaced on each sync.
// googleId is the event's id in its source (Google's event id, or an ICS
// UID with its occurrence). private marks an event its owner set private
// in the source: it shows as busy even from a public source.
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceId: uuid()
      .notNull()
      .references(() => calendarSources.id, { onDelete: "cascade" }),
    googleId: text().notNull(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    allDay: boolean().notNull(),
    title: text().notNull(),
    location: text().notNull(),
    private: boolean().notNull(),
  },
  (table) => [
    unique().on(table.sourceId, table.googleId),
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
      .references(() => user.id, { onDelete: "cascade" }),
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
