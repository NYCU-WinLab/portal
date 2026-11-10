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

// What changed for members, one row per release-notes/<slug>.md in the
// repo. The deploy's migrate step adds the files it has not seen, stamped
// with the commit being deployed (the bottom-left build) and the time.
export const releaseNotes = pgTable(
  "release_notes",
  {
    slug: text().primaryKey(),
    body: text().notNull(),
    sha: text().notNull(),
    publishedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index().on(table.publishedAt)]
)

// When each member last closed the release dialog: it shows notes
// published after that.
export const releaseReads = pgTable("release_reads", {
  userId: uuid()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  seenAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})
