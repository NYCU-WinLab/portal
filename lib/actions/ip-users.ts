import { asc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { requireAdmin } from "@/lib/actions/authz"
import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { ipUserChanges, ipUserEntries, ipUserSettings } from "@/lib/db/schema"
import { deleteIpUserInput, ipUserInput } from "@/lib/ip-users"

// The lab subnet's address book, for portal admins: who uses which IPv4
// address. Writes keep the old rules: an address inside the subnet, never
// its network address; gateway and broadcast rows stay put; a change names
// the revision it was based on, so two admins never overwrite each other.

const host = (inetValue: string) => inetValue.split("/")[0]

export const listIpUsers = defineAction({
  name: "list_ip_users",
  title: "IP 使用者",
  description:
    "The lab subnet's address book, for portal admins: the subnet, gateway and DNS servers, and every address with its user, category (personal, shared, uncertain, experiment, empty, abnormal, unclassified), notes and revision.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    await requireAdmin(actor, "portal")
    const [settings] = await db.select().from(ipUserSettings)
    const entries = await db
      .select()
      .from(ipUserEntries)
      .orderBy(asc(ipUserEntries.ip))
    return {
      settings: settings
        ? {
            subnet: settings.subnet,
            gateway: host(settings.gateway),
            dnsServers: settings.dnsServers.map(host),
            sourceUpdatedOn: settings.sourceUpdatedOn,
          }
        : null,
      entries: entries.map((entry) => ({
        id: entry.id,
        ip: host(entry.ip),
        userName: entry.userName,
        category: entry.category,
        notes: entry.notes,
        revision: entry.revision,
        updatedAt: entry.updatedAt,
      })),
    }
  },
})

export const saveIpUser = defineAction({
  name: "save_ip_user",
  title: "儲存 IP 使用者",
  description:
    "Portal admins only: adds an address (id and expected_revision null) or changes one (its id and the revision read from list_ip_users). The address must be inside the subnet and not its network address; gateway and broadcast rows keep their address.",
  kind: "mutation",
  input: ipUserInput,
  run: async (actor, input) => {
    await requireAdmin(actor, "portal")
    return db.transaction(async (tx) => {
      const [settings] = await tx
        .select({
          inSubnet: sql<boolean>`${input.ip}::inet << subnet`,
          isNetwork: sql<boolean>`${input.ip}::inet = host(network(subnet))::inet`,
          reserved: sql<boolean>`${input.ip}::inet in (gateway, host(broadcast(subnet))::inet)`,
          gateway: ipUserSettings.gateway,
          broadcast: sql<string>`host(broadcast(subnet))`,
        })
        .from(ipUserSettings)
        .for("share")
      if (!settings) throw new Error("還沒有設定網段")
      if (!settings.inSubnet || settings.isNetwork)
        throw new Error("請確認 IP 在此網段內，且不是保留位址")
      let before: typeof ipUserEntries.$inferSelect | undefined
      if (input.id) {
        ;[before] = await tx
          .select()
          .from(ipUserEntries)
          .where(eq(ipUserEntries.id, input.id))
          .for("update")
        if (!before || before.revision !== input.expected_revision)
          throw new Error("資料已被修改或刪除，請重新整理後再試")
        const wasReserved = [
          host(settings.gateway),
          settings.broadcast,
        ].includes(host(before.ip))
        if (wasReserved && host(before.ip) !== input.ip)
          throw new Error("閘道與廣播位址不能改")
      }
      if (settings.reserved && (!before || host(before.ip) !== input.ip))
        throw new Error("閘道與廣播位址是保留的")
      const values = {
        ip: input.ip,
        userName: input.user_name,
        category: input.category,
        notes: input.notes,
        updatedBy: actor.userId,
      }
      const [after] = await (
        before
          ? tx
              .update(ipUserEntries)
              .set({
                ...values,
                revision: sql`${ipUserEntries.revision} + 1`,
                updatedAt: sql`now()`,
              })
              .where(eq(ipUserEntries.id, before.id))
              .returning()
          : tx.insert(ipUserEntries).values(values).returning()
      ).catch((error: unknown) => {
        if (
          String(
            (error as { cause?: { code?: string } })?.cause?.code ?? ""
          ) === "23505"
        )
          throw new Error("這個 IP 已有紀錄")
        throw error
      })
      await tx.insert(ipUserChanges).values({
        entryId: after.id,
        action: before ? "update" : "create",
        beforeData: before ?? null,
        afterData: after,
        actorId: actor.userId,
      })
      return { id: after.id, revision: after.revision }
    })
  },
})

export const deleteIpUser = defineAction({
  name: "delete_ip_user",
  title: "刪除 IP 使用者",
  description:
    "Portal admins only: deletes one address row by id and the revision read from list_ip_users; gateway and broadcast rows cannot be deleted.",
  kind: "mutation",
  input: deleteIpUserInput,
  run: async (actor, input) => {
    await requireAdmin(actor, "portal")
    return db.transaction(async (tx) => {
      const [settings] = await tx
        .select({
          gateway: ipUserSettings.gateway,
          broadcast: sql<string>`host(broadcast(subnet))`,
        })
        .from(ipUserSettings)
        .for("share")
      const [before] = await tx
        .select()
        .from(ipUserEntries)
        .where(eq(ipUserEntries.id, input.id))
        .for("update")
      if (!before || before.revision !== input.expected_revision)
        throw new Error("資料已被修改或刪除，請重新整理後再試")
      if (
        settings &&
        [host(settings.gateway), settings.broadcast].includes(host(before.ip))
      )
        throw new Error("閘道與廣播位址不能刪")
      await tx.delete(ipUserEntries).where(eq(ipUserEntries.id, input.id))
      await tx.insert(ipUserChanges).values({
        entryId: input.id,
        action: "delete",
        beforeData: before,
        actorId: actor.userId,
      })
      return { deleted: true }
    })
  },
})
