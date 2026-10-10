import { and, eq, inArray } from "drizzle-orm"

import type { Actor } from "@/lib/actions/define"
import { type AdminApp, adminApps, ownAdminsOnly } from "@/lib/apps"
import { db } from "@/lib/db"
import { admins } from "@/lib/db/schema"

/** Whether the member administers app, directly or as a portal admin
 * (except for the apps in ownAdminsOnly). */
export async function isAdmin(actor: Actor, app: AdminApp) {
  const [row] = await db
    .select({ app: admins.app })
    .from(admins)
    .where(
      and(
        eq(admins.userId, actor.userId),
        inArray(
          admins.app,
          app === "portal" || ownAdminsOnly.includes(app)
            ? [app]
            : ["portal", app]
        )
      )
    )
    .limit(1)
  return Boolean(row)
}

/** The one check every admin-only action starts with. */
export async function requireAdmin(actor: Actor, app: AdminApp) {
  if (!(await isAdmin(actor, app)))
    throw new Error(`需要${adminApps[app]}管理員權限`)
}
