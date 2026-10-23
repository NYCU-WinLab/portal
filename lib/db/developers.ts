import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

// Applications members register to sign people in with their lab account
// (/developers): an OAuth 2.0 authorization-code service with S256 PKCE.
// Secrets, codes and tokens are kept only as SHA-256 hashes.
export const developerApps = pgTable(
  "developer_apps",
  {
    id: uuid().defaultRandom().primaryKey(),
    ownerId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text().notNull(),
    contactEmail: text().notNull(),
    privacyUrl: text().notNull(),
    clientType: text().notNull(),
    redirectUris: text().array().notNull(),
    approvedScopes: text()
      .array()
      .default(sql`array['profile']`)
      .notNull(),
    enabled: boolean().default(true).notNull(),
    secretHash: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index().on(table.ownerId),
    check(
      "developer_apps_client",
      sql`(${table.clientType} = 'public' and ${table.secretHash} is null) or (${table.clientType} = 'confidential' and ${table.secretHash} ~ '^[a-f0-9]{64}$')`
    ),
  ]
)

// Asking a portal admin for the restricted scopes (name, groups).
export const developerScopeRequests = pgTable(
  "developer_scope_requests",
  {
    id: uuid().defaultRandom().primaryKey(),
    appId: uuid()
      .notNull()
      .references(() => developerApps.id, { onDelete: "cascade" }),
    scopes: text().array().notNull(),
    purpose: text().notNull(),
    status: text().default("pending").notNull(),
    reviewedBy: uuid().references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp({ withTimezone: true }),
    reviewNote: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index().on(table.appId),
    uniqueIndex("developer_scope_requests_pending_idx")
      .on(table.appId)
      .where(sql`${table.status} = 'pending'`),
  ]
)

// A member's consent to one application, for 30 days at most.
export const developerGrants = pgTable(
  "developer_grants",
  {
    id: uuid().defaultRandom().primaryKey(),
    appId: uuid()
      .notNull()
      .references(() => developerApps.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scopes: text().array().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp({ withTimezone: true })
      .default(sql`now() + interval '30 days'`)
      .notNull(),
  },
  (table) => [index().on(table.appId), index().on(table.userId)]
)

export const developerCodes = pgTable(
  "developer_codes",
  {
    hash: text().primaryKey(),
    grantId: uuid()
      .notNull()
      .references(() => developerGrants.id, { onDelete: "cascade" }),
    scopes: text().array().notNull(),
    redirectUri: text().notNull(),
    challenge: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [index().on(table.grantId)]
)

export const developerTokens = pgTable(
  "developer_tokens",
  {
    accessHash: text().primaryKey(),
    refreshHash: text().notNull().unique(),
    refreshUsed: boolean().default(false).notNull(),
    grantId: uuid()
      .notNull()
      .references(() => developerGrants.id, { onDelete: "cascade" }),
    scopes: text().array().notNull(),
    accessExpiresAt: timestamp({ withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [index().on(table.grantId)]
)
