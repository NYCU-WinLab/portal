import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

export const meetingKinds = ["regular", "holiday", "speaker", "thesis"] as const
export type MeetingKind = (typeof meetingKinds)[number]

// The papers a presenter may choose from. Admins add them; a regular week's
// paper must be one of these.
export const papers = pgTable("papers", {
  id: uuid().defaultRandom().primaryKey(),
  title: text().notNull(),
  url: text(),
  /** Where it was published, e.g. "NSDI'24". */
  venue: text(),
  addedBy: uuid().references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

// One row per Monday lab meeting; the date is the key members use.
// kind replaces the old holiday / speaker / thesis flags, so they cannot
// clash. title is free text for a speaker or thesis week (and for weeks
// imported from before the paper rule); a regular week names a paper.
export const meetings = pgTable(
  "meetings",
  {
    id: uuid().defaultRandom().primaryKey(),
    date: date({ mode: "string" }).notNull().unique(),
    /** What the lab calls the week: "第 3 週", "寒假". Set when a semester is
     * generated; admins may change it. */
    label: text(),
    kind: text({ enum: meetingKinds }).notNull().default("regular"),
    /** Why a holiday week has no meeting, e.g. "國慶日". */
    holiday: text(),
    presenterId: uuid().references(() => user.id, { onDelete: "set null" }),
    paperId: uuid().references(() => papers.id, { onDelete: "restrict" }),
    title: text(),
    slidesUrl: text(),
    recordingUrl: text(),
    notes: text(),
    location: text().notNull().default("EC 411"),
    startsAt: time().notNull().default("15:30"),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "meetings_kind_known",
      sql`${table.kind} in ('regular', 'holiday', 'speaker', 'thesis')`
    ),
    // Only a regular or thesis week has a member presenting.
    check(
      "meetings_presenter_kind",
      sql`${table.presenterId} is null or ${table.kind} in ('regular', 'thesis')`
    ),
    check(
      "meetings_paper_kind",
      sql`${table.paperId} is null or ${table.kind} = 'regular'`
    ),
  ]
)

// Who presents, in turn. Within a status (doctoral before master) members go
// by cohort, which Keycloak holds; position orders a cohort.
export const presenters = pgTable("presenters", {
  userId: uuid()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  position: integer().notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

// Who asks questions each week. manual seats were picked by an admin and are
// never moved by the automatic assignment.
export const meetingQuestioners = pgTable(
  "meeting_questioners",
  {
    meetingId: uuid()
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    manual: boolean().notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.meetingId, table.userId] }),
    index().on(table.userId),
  ]
)
