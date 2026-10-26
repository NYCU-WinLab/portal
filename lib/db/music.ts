import { sql } from "drizzle-orm"
import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

// A YouTube video as the lab knows it: what the queue shows and what the
// player asks YouTube for. One row per video, however often it is queued.
export const musicTracks = pgTable("music_tracks", {
  videoId: text().primaryKey(),
  title: text().notNull(),
  artist: text().notNull().default(""),
  durationS: integer(),
  thumbnail: text(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

// One play of a track. queued items play in sort order; one item at most is
// playing. A cut-in sends the playing item back to the front with resumeAtS,
// so nobody loses their song.
export const musicQueueItems = pgTable(
  "music_queue_items",
  {
    id: uuid().defaultRandom().primaryKey(),
    videoId: text()
      .notNull()
      .references(() => musicTracks.videoId),
    status: text({ enum: ["queued", "playing", "done", "skipped", "removed"] })
      .notNull()
      .default("queued"),
    sort: doublePrecision().notNull(),
    addedBy: uuid().references(() => user.id, { onDelete: "set null" }),
    // How it entered: queue (the end), next (the front), cut_in (at once),
    // or auto (recommended when the queue ran dry; addedBy is null).
    addedAs: text({ enum: ["queue", "next", "cut_in", "auto"] })
      .notNull()
      .default("queue"),
    // The playlist link it came from, when it came with others.
    playlistId: text(),
    resumeAtS: real().notNull().default(0),
    startedAt: timestamp({ withTimezone: true }),
    endedAt: timestamp({ withTimezone: true }),
    endedBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("music_queue_items_status_sort").on(table.status, table.sort),
    index("music_queue_items_ended").on(table.endedAt),
  ]
)

// What happened, newest first on the page: who added, cut in, skipped,
// paused or turned the volume. detail holds counts, levels and playlist titles
// from YouTube, never text
// a member typed.
export const musicActivities = pgTable(
  "music_activities",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    userId: uuid().references(() => user.id, { onDelete: "set null" }),
    kind: text({
      enum: [
        "add",
        "next",
        "cut_in",
        "playlist",
        "skip",
        "remove",
        "pause",
        "resume",
        "volume",
        "auto",
        "autoplay",
      ],
    }).notNull(),
    itemId: uuid().references(() => musicQueueItems.id, {
      onDelete: "set null",
    }),
    detail: jsonb().$type<{
      count?: number
      volume?: number
      title?: string
      on?: boolean
    }>(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("music_activities_created").on(table.createdAt)]
)

// The one player (row id 1): what members asked for (paused, volume) and
// what the player on the lab network last reported.
export const musicPlayer = pgTable("music_player", {
  id: integer().primaryKey().default(1),
  paused: boolean().notNull().default(false),
  volume: real().notNull().default(40),
  // When the queue runs dry, recommend the next song (autoplay.ts).
  autoplay: boolean().notNull().default(true),
  // Bumped on every change the player must follow; it long-polls on it.
  version: integer().notNull().default(0),
  positionS: real().notNull().default(0),
  positionAt: timestamp({ withTimezone: true }),
  state: text({ enum: ["idle", "loading", "playing", "waiting", "error"] })
    .notNull()
    .default("idle"),
  error: text(),
  seenAt: timestamp({ withTimezone: true }),
  updatedAt: timestamp({ withTimezone: true })
    .default(sql`now()`)
    .notNull(),
})

// Lyrics for a track as LRCLIB had them when first asked: timed LRC text,
// plain text, or neither. A miss is kept too, and asked again after a week.
export const musicLyrics = pgTable("music_lyrics", {
  videoId: text()
    .primaryKey()
    .references(() => musicTracks.videoId, { onDelete: "cascade" }),
  synced: text(),
  plain: text(),
  fetchedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})
