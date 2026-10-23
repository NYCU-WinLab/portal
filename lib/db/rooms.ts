import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"
import { meetings } from "@/lib/db/meetings"
import type { Attendee } from "@/lib/rooms/meeting"

// Standing meetings: the scheduler books each occurrence a week ahead.
// title is already the full Teams topic ([prefix]-suffix), frozen with
// the prefix, group and epics when the series is made.
export const roomSeries = pgTable(
  "room_series",
  {
    id: uuid().defaultRandom().primaryKey(),
    title: text().notNull(),
    weekday: smallint().notNull(),
    startTime: text().notNull(),
    durationMinutes: integer().notNull(),
    intervalWeeks: smallint().default(1).notNull(),
    anchorDate: date({ mode: "string" }).notNull(),
    attendees: jsonb().$type<Attendee[]>().default([]).notNull(),
    includeAdvisor: boolean().default(false).notNull(),
    online: boolean().default(true).notNull(),
    meetingPrefix: text(),
    groupName: text(),
    agenda: text(),
    issueRefs: text()
      .array()
      .default(sql`'{}'`)
      .notNull(),
    deliverables: text()
      .array()
      .default(sql`'{}'`)
      .notNull(),
    active: boolean().default(true).notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("room_series_weekday", sql`${table.weekday} between 0 and 6`),
    check("room_series_interval", sql`${table.intervalWeeks} in (1, 2)`),
    check(
      "room_series_duration",
      sql`${table.durationMinutes} between 30 and 300`
    ),
  ]
)

// A meeting the portal booked: a department room through the lab's shared
// account (room and external_id null for an online-only meeting), a Teams
// meeting when online. Cancelled rows stay, for the GitLab feed.
export const roomBookings = pgTable(
  "room_bookings",
  {
    id: uuid().defaultRandom().primaryKey(),
    externalId: text(),
    room: text(),
    date: date({ mode: "string" }).notNull(),
    startTime: text().notNull(),
    endTime: text().notNull(),
    title: text().notNull(),
    attendees: jsonb().$type<Attendee[]>().default([]).notNull(),
    online: boolean().default(true).notNull(),
    meetingPrefix: text(),
    groupName: text(),
    agenda: text(),
    issueRefs: text()
      .array()
      .default(sql`'{}'`)
      .notNull(),
    deliverables: text()
      .array()
      .default(sql`'{}'`)
      .notNull(),
    seriesId: uuid().references(() => roomSeries.id, { onDelete: "set null" }),
    // The Monday lab meeting this booking holds the Teams meeting for.
    meetingId: uuid().references(() => meetings.id, { onDelete: "set null" }),
    // Where it happens when no department room is reserved (EC411).
    place: text(),
    requestedBy: uuid()
      .notNull()
      .references(() => user.id),
    status: text().default("booked").notNull(),
    // RFC 5545 SEQUENCE of the last invite mailed for this booking.
    inviteSequence: integer().default(0).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelledBy: uuid().references(() => user.id),
  },
  (table) => [
    index().on(table.date),
    index().on(table.requestedBy),
    // One booking per occurrence, however often the scheduler runs.
    uniqueIndex()
      .on(table.seriesId, table.date)
      .where(sql`${table.status} = 'booked' and ${table.seriesId} is not null`),
    uniqueIndex()
      .on(table.meetingId)
      .where(
        sql`${table.status} = 'booked' and ${table.meetingId} is not null`
      ),
    check(
      "room_bookings_status",
      sql`${table.status} in ('booked', 'cancelled')`
    ),
    check(
      "room_bookings_room_reserved",
      sql`(${table.room} is null) = (${table.externalId} is null)`
    ),
  ]
)

// One ask to the GitLab pipeline that creates or cancels a booking's Teams
// meeting. The pipeline answers on /api/rooms/meeting-callback with a
// one-time token, of which only the SHA-256 is kept.
export const roomMeetingRequests = pgTable(
  "room_meeting_requests",
  {
    id: uuid().defaultRandom().primaryKey(),
    requestId: text().notNull().unique(),
    bookingId: uuid()
      .notNull()
      .references(() => roomBookings.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    callbackTokenHash: text().notNull(),
    status: text().default("pending").notNull(),
    stage: text(),
    joinUrl: text(),
    cancelId: text(),
    messageId: text(),
    optionsApplied: boolean(),
    errorCode: text(),
    errorMessage: text(),
    pipelineId: text(),
    pipelineUrl: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp({ withTimezone: true }),
    notifiedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index().on(table.bookingId),
    index()
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    check(
      "room_meeting_requests_kind",
      sql`${table.kind} in ('create', 'cancel')`
    ),
    check(
      "room_meeting_requests_status",
      sql`${table.status} in ('pending', 'success', 'failed')`
    ),
  ]
)

// The days the daily rooms run has done, so a restart or a second process
// never books the same occurrences or mails the same failures twice.
export const roomDailyRuns = pgTable("room_daily_runs", {
  date: date({ mode: "string" }).primaryKey(),
  ranAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})
