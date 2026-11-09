import { createHash, randomBytes } from "node:crypto"

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { type ApiApp, serviceApps } from "@/lib/api-apps"
import { db } from "@/lib/db"
import { serviceKeys, user } from "@/lib/db/schema"

// Service keys: API keys that belong to the lab, not to a member, for
// another lab service calling the portal (viewer.winlab.tw mailing an
// invitation). Portal admins make, list and revoke them; a key works until
// it is revoked, whoever made it. It runs actions with the key's id as the
// actor's userId and the service's name in actor.service, and only in
// serviceApps, whose actions never act as a person.

const PREFIX = "wsk_"
export const SERVICE_TOKEN = /^wsk_[A-Za-z0-9_-]{43}$/

const hash = (token: string) => createHash("sha256").update(token).digest("hex")

export const listServiceKeys = defineAction({
  name: "list_service_keys",
  title: "服務金鑰",
  description:
    "The lab's active service keys (keys other lab services use to call the portal, owned by no member): id, service name, the apps each may use, the first characters of the key, who made it, when it was made and last used. Never the key itself. Portal admins only.",
  kind: "query",
  admin: "portal",
  input: z.object({}),
  run: async () => {
    const keys = await db
      .select({
        id: serviceKeys.id,
        service: serviceKeys.service,
        apps: serviceKeys.apps,
        prefix: serviceKeys.prefix,
        createdAt: serviceKeys.createdAt,
        lastUsedAt: serviceKeys.lastUsedAt,
        createdBy: user.name,
      })
      .from(serviceKeys)
      .leftJoin(user, eq(user.id, serviceKeys.createdBy))
      .where(isNull(serviceKeys.revokedAt))
      .orderBy(desc(serviceKeys.createdAt))
    return { keys }
  },
})

export const createServiceKey = defineAction({
  name: "create_service_key",
  title: "建立服務金鑰",
  description:
    "Makes a key for a lab service, owned by the lab rather than the admin who makes it, allowed into the given service apps, and returns it once; only its hash is kept. Portal admins only.",
  kind: "mutation",
  admin: "portal",
  mcpExcludedBecause:
    "the key is shown once and outlives its maker; an admin makes it on /api-keys so it never passes through an agent's context",
  input: z.object({
    service: z.string().trim().min(1, "請填服務名稱").max(60, "名稱最多 60 字"),
    apps: z
      .array(z.enum(serviceApps))
      .min(1, "至少選一個 app")
      .transform((apps) => [...new Set(apps)]),
  }),
  run: async (actor, { service, apps }) => {
    const token = PREFIX + randomBytes(32).toString("base64url")
    const [created] = await db
      .insert(serviceKeys)
      .values({
        service,
        apps,
        tokenHash: hash(token),
        prefix: token.slice(0, PREFIX.length + 6),
        createdBy: actor.userId,
      })
      .returning({ id: serviceKeys.id, service: serviceKeys.service })
    return { ...created, token }
  },
})

export const revokeServiceKey = defineAction({
  name: "revoke_service_key",
  title: "撤銷服務金鑰",
  description:
    "Revokes one service key by id so the service can no longer call the portal with it. Portal admins only. Fails when the key is not found or already revoked.",
  kind: "mutation",
  admin: "portal",
  input: z.object({ id: z.uuid() }),
  run: async (actor, { id }) => {
    const [revoked] = await db
      .update(serviceKeys)
      .set({ revokedAt: new Date(), revokedBy: actor.userId })
      .where(and(eq(serviceKeys.id, id), isNull(serviceKeys.revokedAt)))
      .returning({ id: serviceKeys.id, service: serviceKeys.service })
    if (!revoked) throw new Error("找不到這把金鑰")
    return revoked
  },
})

/** Checks a service key: its id, service and apps, or null when it is not
 * a live service key. Not an action: the caller has no session. */
export async function checkServiceKey(
  token: string,
  { touch = true }: { touch?: boolean } = {}
): Promise<{ id: string; service: string; apps: ApiApp[] } | null> {
  if (!SERVICE_TOKEN.test(token)) return null
  const live = and(
    eq(serviceKeys.tokenHash, hash(token)),
    isNull(serviceKeys.revokedAt)
  )
  const columns = {
    id: serviceKeys.id,
    service: serviceKeys.service,
    apps: serviceKeys.apps,
  }
  const [row] = touch
    ? await db
        .update(serviceKeys)
        .set({ lastUsedAt: sql`now()` })
        .where(live)
        .returning(columns)
    : await db.select(columns).from(serviceKeys).where(live).limit(1)
  if (!row) return null
  return {
    ...row,
    // Only service apps, whatever the row says.
    apps: row.apps.filter((app): app is ApiApp =>
      (serviceApps as readonly string[]).includes(app)
    ),
  }
}
