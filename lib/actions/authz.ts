import { and, eq, inArray } from "drizzle-orm"
import { forbidden } from "next/navigation"

import type { Actor } from "@/lib/actions/define"
import {
  type AdminApp,
  adminAppKeys,
  adminApps,
  ownAdminsOnly,
} from "@/lib/apps"
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
    throw new Error(`需要 ${adminApps[app]} 管理員權限`)
}

/** Every app the member administers, by the same rule as isAdmin: what
 * the home page and the app navs show them. */
export async function adminAppsOf(actor: Actor) {
  const rows = await db
    .select({ app: admins.app })
    .from(admins)
    .where(eq(admins.userId, actor.userId))
  const direct = new Set(rows.map((row) => row.app as AdminApp))
  return new Set(
    adminAppKeys.filter(
      (app) =>
        direct.has(app) ||
        (direct.has("portal") && !ownAdminsOnly.includes(app))
    )
  )
}

/** An entry a member sees only as an admin of app; hiding it is only for
 * the eye, the page and its actions check again. */
export type Gated = { admin?: AdminApp }

export const visibleTo = <T extends Gated>(apps: Set<AdminApp>, items: T[]) =>
  items.filter((item) => !item.admin || apps.has(item.admin))

/** The guard of an admin-only page: the 403 page (app/forbidden.tsx) for
 * anyone else, never a silent redirect. */
export async function requireAdminPage(actor: Actor, app: AdminApp) {
  if (!(await isAdmin(actor, app))) forbidden()
}
