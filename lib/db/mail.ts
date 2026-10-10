import { sql } from "drizzle-orm"
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

// Mail waiting to go out. An action queues a row in its own transaction, so
// the mail exists exactly when the change does; lib/actions/mail.ts sends it
// and stamps sent_at, retrying a failed send a few times.
export const mailOutbox = pgTable(
  "mail_outbox",
  {
    id: uuid().defaultRandom().primaryKey(),
    to: text().array().notNull(),
    subject: text().notNull(),
    text: text().notNull(),
    html: text(),
    attempts: integer().default(0).notNull(),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index()
      .on(table.createdAt)
      .where(sql`${table.sentAt} is null`),
  ]
)
