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
    bcc: text()
      .array()
      .default(sql`'{}'`)
      .notNull(),
    subject: text().notNull(),
    text: text().notNull(),
    html: text(),
    replyTo: text(),
    // A calendar invite (text/calendar) and its METHOD, REQUEST or CANCEL.
    ics: text(),
    icsMethod: text(),
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

// Invitations other lab services send through the portal's mail, such as
// a viewer.winlab.tw guest link: who sent it (the API key's owner), for
// whom, to where. Kept for the record and for the hourly limit.
export const invitations = pgTable(
  "invitations",
  {
    id: uuid().defaultRandom().primaryKey(),
    /** The member whose API key sent it. */
    senderId: uuid().notNull(),
    to: text().notNull(),
    url: text().notNull(),
    outboxId: uuid(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index().on(table.senderId, table.createdAt)]
)
