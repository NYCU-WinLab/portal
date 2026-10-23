import { customType, pgTable, timestamp, uuid } from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" })

// A member's picture, re-encoded by the portal as square WebP (EXIF and
// every other tag dropped): small for the 40px avatars, large for the
// profile. version changes on every upload; the image route serves by it.
export const memberAvatars = pgTable("member_avatars", {
  userId: uuid()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  small: bytea().notNull(),
  large: bytea().notNull(),
  version: uuid().defaultRandom().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})
