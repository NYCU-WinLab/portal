import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  cidr,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

// The lab subnet's address book (/admins/ip-users): which address is whose.
// One row of settings: the subnet, its gateway and DNS servers.
export const ipUserSettings = pgTable(
  "ip_user_settings",
  {
    id: boolean().default(true).primaryKey(),
    subnet: cidr().notNull(),
    gateway: inet().notNull(),
    dnsServers: inet()
      .array()
      .default(sql`'{}'`)
      .notNull(),
    sourceUpdatedOn: date({ mode: "string" }).notNull(),
  },
  (table) => [
    check("ip_user_settings_single", sql`${table.id}`),
    check(
      "ip_user_settings_gateway_in_subnet",
      sql`${table.gateway} << ${table.subnet}`
    ),
  ]
)

export const ipUserEntries = pgTable(
  "ip_user_entries",
  {
    id: uuid().defaultRandom().primaryKey(),
    ip: inet().notNull().unique(),
    userName: text().default("").notNull(),
    category: text().default("unclassified").notNull(),
    notes: text().default("").notNull(),
    revision: integer().default(1).notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedBy: uuid(),
  },
  (table) => [
    check(
      "ip_user_entries_category",
      sql`${table.category} in ('personal', 'shared', 'uncertain', 'experiment', 'empty', 'abnormal', 'unclassified')`
    ),
    check(
      "ip_user_entries_host",
      sql`family(${table.ip}) = 4 and masklen(${table.ip}) = 32`
    ),
  ]
)

// Every change, with the row before and after; it outlives entries and
// accounts, so actor_id is a plain id.
export const ipUserChanges = pgTable(
  "ip_user_changes",
  {
    id: uuid().defaultRandom().primaryKey(),
    entryId: uuid().notNull(),
    action: text().notNull(),
    beforeData: jsonb(),
    afterData: jsonb(),
    actorId: uuid(),
    changedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index().on(table.entryId, table.changedAt)]
)
