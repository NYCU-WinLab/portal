import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { apiKeys } from "@/lib/db/api-keys"
import { user } from "@/lib/db/auth-schema"

// Every attempt to open the lab door: a press on /door (web), an agent
// pressing for a member (mcp), or a swipe at the card reader (card), which
// hams-bridge reports. name is who it was at the time: the member's name for
// a press, the card holder's for a swipe ("卡片" when the card had none).
// A card swipe's at is the reader's clock; ok is null for reader events that
// are neither a grant nor a known denial.
// The door tokens before they became API keys (api_keys, same ids). Kept
// one release so a rollback finds its table; dropped in the next.
export const doorTokens = pgTable(
  "door_tokens",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text().notNull(),
    tokenHash: text().notNull().unique(),
    prefix: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp({ withTimezone: true }),
    // The rate limit: openings claimed since windowStartedAt, reset an hour
    // after it. Claimed before the relay is called, so a slow door cannot
    // let extra calls through.
    windowStartedAt: timestamp({ withTimezone: true }),
    windowCount: integer().default(0).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: uuid().references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [index().on(table.userId)]
)

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
    // An opening with an API key: which key, from where.
    tokenId: uuid().references(() => apiKeys.id, { onDelete: "set null" }),
    ip: text(),
  },
  (table) => [
    index().on(table.at),
    index().on(table.userId),
    index().on(table.tokenId),
    check(
      "door_events_source",
      sql`${table.source} in ('web', 'mcp', 'api', 'card')`
    ),
    check(
      "door_events_card_shape",
      sql`(${table.source} = 'card') = (${table.sourceEventId} is not null and ${table.cardId} is not null)`
    ),
  ]
)

// The cards the reader lets in, as the portal knows them; the reader keeps
// its own copy, and the two are compared (sync_state: synced, missing when
// the reader lacks it, unknown when a write went unconfirmed). updated_at
// moves only when the card changes hands: a swipe is credited to the holder
// only from then on. holder_name is what
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

// Every change to the reader's card table and every comparison with it,
// by a door admin or by the daily check (user_id null). ok false with the
// bridge's code in error; detail holds what the attempt saw (counts, the
// card numbers that differed).
export const doorCardChanges = pgTable(
  "door_card_changes",
  {
    id: uuid().defaultRandom().primaryKey(),
    at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    action: text().notNull(),
    cardId: text(),
    userId: uuid().references(() => user.id, { onDelete: "set null" }),
    ok: boolean().notNull(),
    error: text(),
    detail: jsonb().$type<Record<string, unknown>>(),
  },
  (table) => [
    index().on(table.at),
    check(
      "door_card_changes_action",
      sql`${table.action} in ('add', 'update', 'delete', 'import', 'compare')`
    ),
  ]
)

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" })

// How the door greets a member: the suffix after their name on the LED
// panel ("歡迎 詠翔！！"). The sound after it comes from their playlist.
export const doorGreetings = pgTable("door_greetings", {
  userId: uuid()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  suffix: text(),
  // false: the door plays only the sound, without "Hi <name>" before it.
  speakName: boolean().default(true).notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

// The lab's pool of door sounds: every member's upload, shared, so anyone
// can play one or put it on their playlist. version changes whenever its
// file is replaced, and the panel and the players cache by it. is_default
// marks the ones played for a member with an empty playlist; door admins
// pick them.
export const doorSounds = pgTable(
  "door_sounds",
  {
    id: uuid().defaultRandom().primaryKey(),
    label: text().notNull(),
    uploaderId: uuid().references(() => user.id, { onDelete: "set null" }),
    sound: bytea().notNull(),
    soundType: text().notNull(),
    version: uuid().defaultRandom().notNull(),
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

// What the door says around a member's name, by the time of day: before +
// name + after ("晚安，" 詠翔 "。這麼晚來，很認真喔。"). Times are minutes
// after midnight in Asia/Taipei; ends_at at or before starts_at runs past
// midnight into the next day. days is a bitmask of the weekday the range
// starts on, Monday 1 to Sunday 64. Each member keeps their own phrases and
// door admins keep the defaults (user_id null): the door says one of the
// member's own phrases in force, else one of the defaults in force, else
// "Hi <name>". first_visit phrases are
// said only on a member's first opening of the day (from 06:00), and win
// over the others in force then.
export const doorPhrases = pgTable(
  "door_phrases",
  {
    id: uuid().defaultRandom().primaryKey(),
    before: text().default("").notNull(),
    after: text().default("").notNull(),
    startsAt: smallint().notNull(),
    endsAt: smallint().notNull(),
    days: smallint().default(127).notNull(),
    enabled: boolean().default(true).notNull(),
    firstVisit: boolean().default(false).notNull(),
    // The member whose own phrase this is; null for the lab's defaults,
    // which the door says to a member none of their own phrases covers.
    userId: uuid().references(() => user.id, { onDelete: "cascade" }),
    createdBy: uuid().references(() => user.id, { onDelete: "set null" }),
    updatedBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "door_phrases_text",
      sql`${table.before} <> '' or ${table.after} <> ''`
    ),
    check(
      "door_phrases_minutes",
      sql`${table.startsAt} between 0 and 1439 and ${table.endsAt} between 0 and 1439 and ${table.startsAt} <> ${table.endsAt}`
    ),
    check("door_phrases_days", sql`${table.days} between 1 and 127`),
    index("door_phrases_user_id_idx").on(table.userId),
  ]
)

// The door's spoken parts in CC's cloned voice, one clip per text ("晚安，",
// "詠翔，", "詠翔。"). The voice job on furnace lists the texts the door
// needs, makes the missing ones and uploads them; idm-display splices the
// parts of a greeting when every one has a clip. A clip's bytes never
// change, so its id is the version the door caches it by.
export const doorVoiceClips = pgTable("door_voice_clips", {
  id: uuid().defaultRandom().primaryKey(),
  text: text().notNull().unique(),
  audio: bytea().notNull(),
  audioType: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})
