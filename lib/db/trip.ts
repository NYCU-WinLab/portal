import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" })

// A business trip: a folder members upload their receipts into while it is
// open. Trip admins (not portal admins: the files carry signatures) see
// everyone's files.
export const trips = pgTable(
  "trips",
  {
    id: uuid().defaultRandom().primaryKey(),
    name: text().notNull(),
    description: text(),
    status: text().default("open").notNull(),
    closedAt: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("trips_status", sql`${table.status} in ('open', 'closed')`)]
)

// One PDF a member uploaded to a trip (images are turned into PDFs on the
// way in). Lists select the columns they need and never data.
export const tripFiles = pgTable(
  "trip_files",
  {
    id: uuid().defaultRandom().primaryKey(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    userId: uuid().references(() => user.id, { onDelete: "set null" }),
    filename: text().notNull(),
    description: text(),
    size: integer().notNull(),
    data: bytea().notNull(),
    /** PAdES level the portal signed it to (B-LT, or B-B without a
     * timestamp); null for files from before signing. */
    signatureLevel: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index().on(table.tripId, table.userId)]
)

// A member's handwritten signature and how it goes on their documents.
// Shared by every app that signs (trip now, approve later).
export const signatures = pgTable(
  "signatures",
  {
    userId: uuid()
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    contentType: text(),
    image: bytea(),
    /** Put the signature on documents the member uploads. */
    stamp: boolean().default(true).notNull(),
    /** Which corner of the first page: tl, tr, bl or br. */
    corner: text().default("br").notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "signatures_corner",
      sql`${table.corner} in ('tl', 'tr', 'bl', 'br')`
    ),
  ]
)
