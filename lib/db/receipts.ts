import { sql } from "drizzle-orm"
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"
import { mailOutbox } from "@/lib/db/mail"

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" })

// Receipts the lab's assistants collect for reimbursement: a PDF (photos
// become PDFs on the way in), the funding project it is charged to, the
// account the money goes into, and whether it has been checked. Receipts
// admins only. mail_id is the notice sent to accounting on upload.
export const receipts = pgTable(
  "receipts",
  {
    id: uuid().defaultRandom().primaryKey(),
    name: text().notNull(),
    project: text(),
    depositAccount: text(),
    status: text().default("pending").notNull(),
    uploaderId: uuid().references(() => user.id, { onDelete: "set null" }),
    size: integer().notNull(),
    data: bytea().notNull(),
    mailId: uuid().references(() => mailOutbox.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index().on(table.createdAt),
    check("receipts_status", sql`${table.status} in ('pending', 'approved')`),
    check(
      "receipts_deposit_account",
      sql`${table.depositAccount} in ('post', 'esun')`
    ),
  ]
)
