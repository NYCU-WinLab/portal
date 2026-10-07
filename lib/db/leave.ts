import { sql } from "drizzle-orm"
import {
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

// Absences from the Monday lab meeting. No updated_at and no update path:
// a member withdraws and signs up again.
export const leaves = pgTable(
  "leaves",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    reason: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique().on(table.userId, table.date),
    index().on(table.date),
    check("leaves_date_is_monday", sql`extract(dow from ${table.date}) = 1`),
  ]
)
