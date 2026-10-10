import { sql } from "drizzle-orm"
import {
  check,
  customType,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" })

// The WinLab signing CA: one root, and one certificate per member that
// signs what they upload. When a member is deleted their row loses its
// user_id, and a trigger (drizzle/0012) revokes the certificate then. Private keys are PKCS#8, encrypted with
// SIGNING_MASTER_KEY (AES-256-GCM: 12-byte IV, then ciphertext and tag).
export const signingKeys = pgTable(
  "signing_keys",
  {
    id: uuid().defaultRandom().primaryKey(),
    kind: text().notNull(),
    userId: uuid().references(() => user.id, { onDelete: "set null" }),
    certificate: bytea().notNull(),
    privateKey: bytea().notNull(),
    serial: text().notNull(),
    notAfter: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("signing_keys_kind", sql`${table.kind} in ('root', 'member')`),
    uniqueIndex("signing_keys_one_root")
      .on(table.kind)
      .where(sql`${table.kind} = 'root' and ${table.revokedAt} is null`),
    uniqueIndex("signing_keys_one_per_member")
      .on(table.userId)
      .where(sql`${table.kind} = 'member' and ${table.revokedAt} is null`),
  ]
)
