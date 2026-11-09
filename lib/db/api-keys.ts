import { sql } from "drizzle-orm"
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

// A member's key for the HTTP API (POST /api/actions/<name>, and
// POST /api/door/open), from a script or a phone shortcut. It acts as the
// member, but only in the apps it names (lib/api-apps.ts). Only the SHA-256
// of the key is kept; prefix is its first characters, to tell keys apart on
// /api-keys. A revoked key stays, for the door log.
// Door tokens lived in door_tokens; the table is api_keys since 0043, and
// a view under the old name keeps the previous release working for one
// release.
export const apiKeys = pgTable(
  "api_keys",
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
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: uuid().references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [index().on(table.userId)]
)

// A service's key (viewer.winlab.tw mailing invitations, say): owned by the
// lab, not by a member, so it keeps working when whoever made it leaves.
// Only portal admins make and revoke them, and only into the apps in
// serviceApps (lib/api-apps.ts), whose actions never need a person. A key
// is "wsk_" and 43 base64url characters; only its SHA-256 is kept. Its id
// is the actor's userId when it runs an action.
export const serviceKeys = pgTable("service_keys", {
  id: uuid().defaultRandom().primaryKey(),
  service: text().notNull(),
  tokenHash: text().notNull().unique(),
  prefix: text().notNull(),
  apps: text().array().notNull(),
  createdBy: uuid().references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp({ withTimezone: true }),
  revokedAt: timestamp({ withTimezone: true }),
  revokedBy: uuid().references(() => user.id, { onDelete: "set null" }),
})
