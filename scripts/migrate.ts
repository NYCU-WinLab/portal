// Applies drizzle/*.sql in order, then publishes the release notes this
// image carries. Bundled into the image as migrate.mjs and run by compose's
// one-shot migrate service before web starts.
import { readdir, readFile } from "node:fs/promises"

import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Pool } from "pg"

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
await migrate(drizzle(pool), { migrationsFolder: "drizzle" })
console.log("migrations applied")

// release-notes/<slug>.md: a note is published by the first deploy that
// carries it, stamped with that deploy's commit (PORTAL_VERSION, sha-<commit>,
// the bottom-left build). A rollback or a later deploy leaves it as it is.
const sha = process.env.PORTAL_VERSION?.match(/^sha-([0-9a-f]{7,})$/)?.[1]
if (sha) {
  const files = (await readdir("release-notes").catch(() => [])).filter(
    (name) => name.endsWith(".md") && name !== "README.md"
  )
  let added = 0
  for (const name of files) {
    const body = (await readFile(`release-notes/${name}`, "utf8")).trim()
    if (!body) continue
    const { rowCount } = await pool.query(
      `insert into release_notes (slug, body, sha) values ($1, $2, $3)
       on conflict (slug) do nothing`,
      [name.slice(0, -3), body, sha.slice(0, 7)]
    )
    added += rowCount ?? 0
  }
  console.log(`release notes: ${added} new of ${files.length}`)
}
await pool.end()
