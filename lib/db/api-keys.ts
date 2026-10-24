import { sql } from "drizzle-orm"
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

// A member's key for the HTTP API (POST /api/actions/<name>, and
// POST /api/door/open), from a script or a phone shortcut. It acts as the
// member, but only in the apps it names (lib/api-apps.ts). Only the SHA-256
// of the key is kept; prefix is its first characters, to tell keys apart on
// /api-keys. A revoked key stays, for the door log.
// The table is still door_tokens, where door tokens lived: the new columns
// only add to it, so a rollback reads the same keys and revocations. Its
// rename to api_keys is a later, separate change.
export const apiKeys = pgTable(
  "door_tokens",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text().notNull(),
    tokenHash: text().notNull().unique(),
    prefix: text().notNull(),
    // Rows from before API keys, and keys an older release makes, are
    // door keys: they only open the door.
    apps: text()
      .array()
      .notNull()
      .default(sql`'{door}'::text[]`),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp({ withTimezone: true }),
    // The door's rate limit: when each opening of the last hour was
    // claimed, a sliding window. Claimed before the relay is called, so a
    // slow door cannot let extra calls through. lastOpenedAt spaces
    // openings apart.
    lastOpenedAt: timestamp({ withTimezone: true }),
    recentOpenings: timestamp({ withTimezone: true })
      .array()
      .notNull()
      .default(sql`'{}'::timestamptz[]`),
    // The fixed window before recentOpenings; no longer written, kept so a
    // rollback still reads them. Dropped with the table rename (issue 144).
    windowStartedAt: timestamp({ withTimezone: true }),
    windowCount: integer().default(0).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: uuid().references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [index().on(table.userId)]
)
