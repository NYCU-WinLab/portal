import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
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

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" })

// How the door greets a member: the suffix after their name on the LED
// panel ("歡迎 詠翔！！"). The sound after it comes from their playlist.
// sound through playSound are the single sound before the pool (0027 moved
// them into it); they stay one release so the previous image still runs
// after a rollback, and nothing reads them.
export const doorGreetings = pgTable(
  "door_greetings",
  {
    userId: uuid()
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    suffix: text(),
    sound: bytea(),
    soundType: text(),
    soundVersion: text(),
    playSound: boolean().default(false).notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "door_greetings_sound_shape",
      sql`(${table.sound} is null) = (${table.soundVersion} is null) and (${table.sound} is null) = (${table.soundType} is null)`
    ),
  ]
)

// The lab's pool of door sounds: every member's upload, shared, so anyone
// can play one or put it on their playlist. A sound's bytes never change, so
// its id is the version the panel caches it by. is_default marks the ones
// played for a member with an empty playlist; door admins pick them.
export const doorSounds = pgTable(
  "door_sounds",
  {
    id: uuid().defaultRandom().primaryKey(),
    label: text().notNull(),
    uploaderId: uuid().references(() => user.id, { onDelete: "set null" }),
    sound: bytea().notNull(),
    soundType: text().notNull(),
    isDefault: boolean().default(false).notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index().on(table.uploaderId),
    check(
      "door_sounds_label",
      sql`char_length(${table.label}) between 1 and 40`
    ),
  ]
)

// What the door plays for a member: one of these at random, so a playlist
// of one always plays that sound.
export const doorPlaylistItems = pgTable(
  "door_playlist_items",
  {
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    soundId: uuid()
      .notNull()
      .references(() => doorSounds.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.soundId] }),
    index().on(table.soundId),
  ]
)
