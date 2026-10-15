import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

// Every attempt to open the lab door: a press on /door (web), an agent
// pressing for a member (mcp), or a swipe at the card reader (card), which
// hams-bridge reports. name is who it was at the time: the member's name for
// a press, the card holder's for a swipe ("卡片" when the card had none).
// A card swipe's at is the reader's clock; ok is null for reader events that
// are neither a grant nor a known denial.
export const doorEvents = pgTable(
  "door_events",
  {
    id: uuid().defaultRandom().primaryKey(),
    at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    source: text().notNull(),
    userId: uuid().references(() => user.id, { onDelete: "set null" }),
    name: text().notNull(),
    ok: boolean(),
    error: text(),
    latencyMs: integer(),
    cardId: text(),
    eventCode: text(),
    reader: smallint(),
    // The bridge's id for a swipe, so a batch sent twice is stored once.
    sourceEventId: text().unique(),
    receivedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index().on(table.at),
    index().on(table.userId),
    check("door_events_source", sql`${table.source} in ('web', 'mcp', 'card')`),
    check(
      "door_events_card_shape",
      sql`(${table.source} = 'card') = (${table.sourceEventId} is not null and ${table.cardId} is not null)`
    ),
  ]
)

// The cards the reader lets in, as the portal knows them; the reader keeps
// its own copy, and the two are compared (sync_state). holder_name is what
// the reader stores (Big5, at most 8 characters), holder_id the member it
// belongs to, when it is one.
export const doorCards = pgTable(
  "door_cards",
  {
    cardId: text().primaryKey(),
    holderName: text().notNull(),
    holderId: uuid().references(() => user.id, { onDelete: "set null" }),
    note: text(),
    syncState: text().default("unknown").notNull(),
    lastSeenAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index().on(table.holderId),
    check("door_cards_card_id", sql`${table.cardId} ~ '^[0-9]{10}$'`),
  ]
)
