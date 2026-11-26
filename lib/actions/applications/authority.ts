import { and, eq, inArray } from "drizzle-orm"

import type { ProcessorAuthority } from "@/lib/applications/ports"
import type { Db } from "@/lib/db"
import {
  admins,
  applicationNotifiees,
  groupManagers,
  user,
} from "@/lib/db/schema"

/**
 * Who may act on applications, from the portal's own tables. Processors are
 * the admins of the accounts app; portal admins also assign more statuses
 * but get no new-application notice. The notifiees are the members who get a copy of each new one.
 */
export class DbProcessorAuthority implements ProcessorAuthority {
  constructor(private readonly db: Db) {}

  async isPortalAdmin(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: admins.userId })
      .from(admins)
      .where(and(eq(admins.userId, userId), eq(admins.app, "portal")))
      .limit(1)
    return row !== undefined
  }

  async isAccountsAdmin(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: admins.userId })
      .from(admins)
      .where(and(eq(admins.userId, userId), eq(admins.app, "accounts")))
      .limit(1)
    return row !== undefined
  }

  async managesGroup(userId: string, groupId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: groupManagers.userId })
      .from(groupManagers)
      .where(
        and(
          eq(groupManagers.userId, userId),
          eq(groupManagers.groupId, groupId)
        )
      )
      .limit(1)
    return row !== undefined
  }

  processorEmails(): Promise<string[]> {
    return this.adminEmails(["accounts"])
  }

  portalAdminEmails(): Promise<string[]> {
    return this.adminEmails(["portal"])
  }

  async notifieeEmails(): Promise<string[]> {
    const rows = await this.db
      .select({ email: user.email })
      .from(applicationNotifiees)
      .innerJoin(user, eq(user.id, applicationNotifiees.userId))
    return unique(rows.map((r) => r.email))
  }

  private async adminEmails(apps: ("accounts" | "portal")[]) {
    const rows = await this.db
      .select({ email: user.email })
      .from(admins)
      .innerJoin(user, eq(user.id, admins.userId))
      .where(inArray(admins.app, apps))
    return unique(rows.map((r) => r.email))
  }
}

/** Distinct addresses, case-insensitively, in first-seen order. */
function unique(emails: (string | null)[]): string[] {
  const seen = new Map<string, string>()
  for (const email of emails) {
    if (email && !seen.has(email.toLowerCase()))
      seen.set(email.toLowerCase(), email)
  }
  return [...seen.values()]
}
