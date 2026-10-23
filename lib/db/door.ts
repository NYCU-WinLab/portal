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
// A member's key for POST /api/door/open, from a script or a phone shortcut.
// Only the SHA-256 of the token is kept; prefix is its first characters, to
// tell keys apart on /door/tokens. A revoked key stays, for the log.
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
    // An opening through POST /api/door/open: which token, from where.
    tokenId: uuid().references(() => doorTokens.id, { onDelete: "set null" }),
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
// The table still holds sound, sound_type, sound_version and play_sound from
// before the pool (0027 moved them into it). Nothing reads or writes them;
// the next migration drops them, once no running image lists them (#78).
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

// What the door says around a member's name, by the time of day: before +
// name + after ("晚安，" 詠翔 "。這麼晚來，很認真喔。"). Times are minutes
// after midnight in Asia/Taipei; ends_at at or before starts_at runs past
// midnight into the next day. days is a bitmask of the weekday the range
// starts on, Monday 1 to Sunday 64. Door admins keep the schedule; when no
// enabled rule matches, the door says "Hi <name>".
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
