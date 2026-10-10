import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"
import { mailOutbox } from "@/lib/db/mail"

// Lab announcements. Portal admins post, edit and delete; every member
// reads. mail_id is the mail that told the lab, when the post asked for one;
// editing never mails again.
export const announcements = pgTable(
  "announcements",
  {
    id: uuid().defaultRandom().primaryKey(),
    title: text().notNull(),
    content: text().notNull(),
    authorId: uuid().references(() => user.id, { onDelete: "set null" }),
    mailId: uuid().references(() => mailOutbox.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index().on(table.createdAt)]
)
