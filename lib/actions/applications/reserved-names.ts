import { eq } from "drizzle-orm"

import { scrubbed } from "@/lib/actions/applications/db-errors"
import type { ReservedNames } from "@/lib/applications/ports"
import type { Db } from "@/lib/db"
import { sshServices } from "@/lib/db/schema"

/**
 * Names an applicant may not claim: the usernames of the realm's system
 * accounts (read from Keycloak by the caller) and every ssh service slug,
 * since both are names on the machines members log in to.
 */
export class DbReservedNames implements ReservedNames {
  constructor(
    private readonly db: Db,
    private readonly systemNames: () => Promise<Set<string>>
  ) {}

  async has(name: string): Promise<boolean> {
    const lower = name.toLowerCase()
    if ((await this.systemNames()).has(lower)) return true
    // The slug is the applicant's username: a query error drops it.
    const [row] = await scrubbed(() =>
      this.db
        .select({ id: sshServices.id })
        .from(sshServices)
        .where(eq(sshServices.slug, lower))
        .limit(1)
    )
    return row !== undefined
  }
}
