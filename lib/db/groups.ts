import { sql } from "drizzle-orm"
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

// Who may change a Google mailing list's members besides portal admins.
// group_id is the Directory API's id, stable across renames.
export const groupManagers = pgTable(
  "group_managers",
  {
    groupId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.userId] })]
)

// Every membership change tried on /groups, refused ones too.
export const groupMembershipAudit = pgTable(
  "group_membership_audit",
  {
    id: uuid().defaultRandom().primaryKey(),
    actorId: uuid().references(() => user.id, { onDelete: "set null" }),
    groupId: text().notNull(),
    groupEmail: text().notNull(),
    memberEmail: text().notNull(),
    action: text().notNull(),
    outcome: text().notNull(),
    detail: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index().on(table.groupId, table.createdAt),
    index().on(table.actorId, table.createdAt),
    check(
      "group_membership_audit_action",
      sql`${table.action} in ('add', 'remove')`
    ),
  ]
)
