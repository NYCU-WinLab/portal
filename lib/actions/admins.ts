import { and, asc, eq, ne } from "drizzle-orm"
import { z } from "zod"

import { requireAdmin } from "@/lib/actions/authz"
import { defineAction } from "@/lib/actions/define"
import { adminAppKeys, adminApps } from "@/lib/apps"
import { db } from "@/lib/db"
import { admins, user } from "@/lib/db/schema"

export const listMembers = defineAction({
  name: "list_members",
  title: "成員名單",
  description:
    "Every lab member on the portal: id, name (Chinese), account name and email, sorted by name. Use it to find a member's id for other tools.",
  kind: "query",
  input: z.object({}),
  run: async () =>
    db
      .select({
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
      })
      .from(user)
      .orderBy(asc(user.name)),
})

export const listAdmins = defineAction({
  name: "list_admins",
  title: "管理員名單",
  description: `Who administers which app, grouped by app. Apps: ${adminAppKeys.map((app) => `${app} (${adminApps[app]})`).join(", ")}. A portal admin administers every app.`,
  kind: "query",
  input: z.object({}),
  run: async () => {
    const rows = await db
      .select({ app: admins.app, userId: user.id, name: user.name })
      .from(admins)
      .innerJoin(user, eq(user.id, admins.userId))
      .orderBy(asc(user.name))
    return {
      apps: adminAppKeys.map((app) => ({
        app,
        label: adminApps[app],
        admins: rows
          .filter((row) => row.app === app)
          .map(({ userId, name }) => ({ userId, name })),
      })),
    }
  },
})

const grantInput = z.object({
  userId: z.uuid("請選擇成員"),
  app: z.enum(adminAppKeys, "請選擇 app"),
})

export const grantAdmin = defineAction({
  name: "grant_admin",
  title: "新增管理員",
  description:
    "Makes a member an admin of one app. Only portal admins can. userId comes from list_members; app is one of the keys list_admins shows.",
  kind: "mutation",
  input: grantInput,
  run: async (actor, { userId, app }) => {
    await requireAdmin(actor, "portal")
    return db.transaction(async (tx) => {
      // Locking the member serializes every grant for them, so a portal
      // grant and an app grant at once cannot leave a stray app row.
      const [member] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .for("update")
      if (!member) throw new Error("找不到成員")
      const [portalRow] = await tx
        .select({ app: admins.app })
        .from(admins)
        .where(and(eq(admins.userId, userId), eq(admins.app, "portal")))
      if (app !== "portal" && portalRow)
        throw new Error("他是全站管理員，已經管得到每個 app")
      const [added] = await tx
        .insert(admins)
        .values({ userId, app, grantedBy: actor.userId })
        .onConflictDoNothing()
        .returning({ app: admins.app })
      if (!added) throw new Error(`已經是${adminApps[app]}管理員了`)
      // A portal admin already runs every app; drop their app-level rows.
      if (app === "portal")
        await tx
          .delete(admins)
          .where(and(eq(admins.userId, userId), ne(admins.app, "portal")))
      return { userId, app }
    })
  },
})

export const revokeAdmin = defineAction({
  name: "revoke_admin",
  title: "移除管理員",
  description:
    "Removes a member's admin role for one app. Only portal admins can, and the last portal admin cannot be removed.",
  kind: "mutation",
  input: grantInput,
  run: async (actor, { userId, app }) => {
    await requireAdmin(actor, "portal")
    return db.transaction(async (tx) => {
      if (app === "portal") {
        // Lock the portal rows so two revokes at once cannot both pass.
        const portalAdmins = await tx
          .select({ userId: admins.userId })
          .from(admins)
          .where(eq(admins.app, "portal"))
          .for("update")
        if (!portalAdmins.some((row) => row.userId === userId))
          throw new Error("他不是全站管理員")
        if (portalAdmins.length <= 1) throw new Error("至少要留 1 位全站管理員")
      }
      const removed = await tx
        .delete(admins)
        .where(and(eq(admins.userId, userId), eq(admins.app, app)))
        .returning({ app: admins.app })
      if (removed.length === 0) throw new Error(`他不是${adminApps[app]}管理員`)
      return { userId, app }
    })
  },
})
