import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

// A member's SSH public key: its type and base64 blob, never a comment or
// options (lib/ssh-keys.ts). A member cannot hold the same key twice.
// source is "paste" or the host it was imported from. machine is the
// computer that holds the private key and description what the key is for:
// both are the member's own words, shown to whoever reads their keys.
export const sshKeys = pgTable(
  "ssh_keys",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    label: text().notNull(),
    machine: text(),
    description: text(),
    type: text().notNull(),
    blob: text().notNull(),
    fingerprint: text().notNull(),
    source: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique().on(table.userId, table.fingerprint)]
)

// Somewhere members log in with their keys (the B09 jump host, Carrel).
// Portal admins make one; its machines read its keys with the read key
// ("wkk_" and 43 base64url characters, only its SHA-256 kept). open: every
// current lab member may use it; otherwise only the members granted below.
export const sshServices = pgTable(
  "ssh_services",
  {
    id: uuid().defaultRandom().primaryKey(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    open: boolean().notNull(),
    tokenHash: text().notNull().unique(),
    prefix: text().notNull(),
    createdBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    lastReadAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    check(
      "ssh_services_slug",
      sql`${table.slug} ~ '^[a-z0-9][a-z0-9-]{0,31}$'`
    ),
  ]
)

// Who may use a service that is not open.
export const sshServiceGrants = pgTable(
  "ssh_service_grants",
  {
    serviceId: uuid()
      .notNull()
      .references(() => sshServices.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    grantedBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.serviceId, table.userId] })]
)

// Which key its owner uses in which service. A key in no service reaches
// no machine.
export const sshKeyServices = pgTable(
  "ssh_key_services",
  {
    keyId: uuid()
      .notNull()
      .references(() => sshKeys.id, { onDelete: "cascade" }),
    serviceId: uuid()
      .notNull()
      .references(() => sshServices.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.keyId, table.serviceId] })]
)

// Every change to who can log in where: keys added and deleted, keys put in
// and taken out of a service, services made, deleted and re-keyed, grants.
// userId is the member it is about; service and fingerprint are copies, so
// a row still reads after its service or key is gone.
export const sshKeyChanges = pgTable(
  "ssh_key_changes",
  {
    id: uuid().defaultRandom().primaryKey(),
    at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    actorId: uuid().references(() => user.id, { onDelete: "set null" }),
    action: text().notNull(),
    userId: uuid().references(() => user.id, { onDelete: "set null" }),
    service: text(),
    fingerprint: text(),
  },
  (table) => [
    index().on(table.at),
    check(
      "ssh_key_changes_action",
      sql`${table.action} in ('add_key', 'delete_key', 'use_key', 'unuse_key', 'create_service', 'delete_service', 'rotate_service', 'grant', 'revoke')`
    ),
  ]
)
