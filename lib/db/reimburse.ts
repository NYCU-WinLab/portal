import { sql } from "drizzle-orm"
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

// The lab's ledger: money paid out to a member for something they bought
// (egress) and money coming in (ingress). Every member reads it; reimburse
// admins write it. Amounts are whole NT$.

export const reimburseEgress = pgTable(
  "reimburse_egress",
  {
    id: uuid().defaultRandom().primaryKey(),
    /** The member paid back; null once they leave the portal. */
    applicantId: uuid().references(() => user.id, { onDelete: "set null" }),
    /** Their name when recorded, shown when applicantId is null (members
     * who left, and old entries naming someone who never had an account). */
    applicantName: text().notNull(),
    item: text().notNull(),
    amount: integer().notNull(),
    invoiceDate: date({ mode: "string" }).notNull(),
    /** When the money was sent; null while it is still owed. */
    transferDate: date({ mode: "string" }),
    /** Bank fee the lab paid on top of amount. */
    transferFee: integer().default(0).notNull(),
    recordedBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index().on(table.invoiceDate),
    index().on(table.applicantId),
    check("reimburse_egress_amount", sql`${table.amount} >= 0`),
    check("reimburse_egress_fee", sql`${table.transferFee} >= 0`),
  ]
)

export const reimburseIngress = pgTable(
  "reimburse_ingress",
  {
    id: uuid().defaultRandom().primaryKey(),
    date: date({ mode: "string" }).notNull(),
    amount: integer().notNull(),
    note: text(),
    recordedBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index().on(table.date),
    check("reimburse_ingress_amount", sql`${table.amount} >= 0`),
  ]
)
