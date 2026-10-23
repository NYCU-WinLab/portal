import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

// One finished game on /games. level is the puzzle or difficulty for the
// games that have one (typing, pipes, queens).
export const gameScores = pgTable(
  "game_scores",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    game: text().notNull(),
    score: integer().notNull(),
    finishTimeMs: integer().notNull(),
    level: smallint(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index().on(table.game, table.level, table.score),
    index().on(table.userId, table.createdAt),
    check(
      "game_scores_game",
      sql`${table.game} in ('2048', 'memory', 'typing', 'snake', 'pipes', 'queens')`
    ),
  ]
)
