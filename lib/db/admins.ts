import { sql } from "drizzle-orm"
import {
  check,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { adminAppKeys } from "@/lib/apps"
import { user } from "@/lib/db/auth-schema"

// Who administers which app; one row per member per app. Granting and
// revoking add or remove a row, so two admins editing at once cannot
// overwrite each other.
export const admins = pgTable(
  "admins",
  {
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    app: text().notNull(),
    grantedBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.app] }),
    check(
      "admins_app_known",
      sql.raw(`app in (${adminAppKeys.map((app) => `'${app}'`).join(", ")})`)
    ),
  ]
)
