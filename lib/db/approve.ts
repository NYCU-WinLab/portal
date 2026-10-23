import { sql } from "drizzle-orm"
import {
  check,
  customType,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" })

// A PDF someone sends round for signatures. draft while its creator places
// fields; pending once sent; completed when every signer has signed.
export const approveDocuments = pgTable(
  "approve_documents",
  {
    id: uuid().defaultRandom().primaryKey(),
    title: text().notNull(),
    pdf: bytea(),
    status: text().default("draft").notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index().on(table.createdBy),
    check(
      "approve_documents_status",
      sql`${table.status} in ('draft', 'pending', 'completed')`
    ),
  ]
)

// A box on one page for one signer, in fractions of the page (0 to 1 from
// the top left). value is what they filled in; for a signature, the image
// as a data URL, so a later change of signature leaves signed papers alone.
export const approveFields = pgTable(
  "approve_fields",
  {
    id: uuid().primaryKey(),
    documentId: uuid()
      .notNull()
      .references(() => approveDocuments.id, { onDelete: "cascade" }),
    signerId: uuid().references(() => user.id, { onDelete: "set null" }),
    page: integer().notNull(),
    x: doublePrecision().notNull(),
    y: doublePrecision().notNull(),
    width: doublePrecision().notNull(),
    height: doublePrecision().notNull(),
    category: text().notNull(),
    label: text(),
    value: text(),
    signedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index().on(table.documentId),
    check(
      "approve_fields_category",
      sql`${table.category} in ('signature', 'contact_address', 'household_address', 'id_number', 'phone', 'other')`
    ),
    check(
      "approve_fields_box",
      sql`${table.page} >= 1 and ${table.x} between 0 and 1 and ${table.y} between 0 and 1 and ${table.width} > 0 and ${table.width} <= 1 and ${table.height} > 0 and ${table.height} <= 1`
    ),
  ]
)

// Who must sign a sent document, and when they did.
export const approveSigners = pgTable(
  "approve_signers",
  {
    documentId: uuid()
      .notNull()
      .references(() => approveDocuments.id, { onDelete: "cascade" }),
    signerId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    signedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.signerId] }),
    index().on(table.signerId),
  ]
)

// What a member filled in last time for each kind of field (address, ID,
// phone), to fill the next document in for them.
export const approveSavedValues = pgTable(
  "approve_saved_values",
  {
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    category: text().notNull(),
    value: text().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.category] })]
)
