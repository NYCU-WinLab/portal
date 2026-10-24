import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import * as schema from "@/lib/db/schema"

// One pool per server process. DATABASE_URL points at the compose Postgres.
// A door reader call can hold a connection for half a minute, so the pool
// has room to spare, and a request waits at most 10 seconds for one instead
// of hanging.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  connectionTimeoutMillis: 10_000,
})

export const db = drizzle(pool, { schema, casing: "snake_case" })
export type Db = typeof db
