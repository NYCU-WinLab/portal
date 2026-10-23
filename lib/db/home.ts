import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

// The services a member starred to the top of their home page. service is a
// key from lib/services.ts; the action checks it, the table does not, so a
// service can leave the list without a migration.
export const homePins = pgTable(
  "home_pins",
  {
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    service: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.service] })]
)
