import { createHash, randomBytes } from "node:crypto"

import { and, count, desc, eq, isNull, lt, or, sql } from "drizzle-orm"
import { z } from "zod"

import { isAdmin } from "@/lib/actions/authz"
import { type Actor, defineAction } from "@/lib/actions/define"
import { apiAppKeys, type ApiApp } from "@/lib/api-apps"
import { isLabMember, isLabMemberNow } from "@/lib/auth/member"
import { db } from "@/lib/db"
import { apiKeys, user } from "@/lib/db/schema"

// API keys run actions through POST /api/actions/<name>, as their owner,
// in the apps the key names. A key is "wak_" and 43 base64url characters
// (32 random bytes); keys made as door tokens start "wdt_" and still work.
// Only its SHA-256 is stored. It has no expiry: it works until its owner or
// a portal or door admin revokes it, or the owner leaves the lab.

const PREFIX = "wak_"
const TOKEN = /^w(ak|dt)_[A-Za-z0-9_-]{43}$/
const MAX_PER_MEMBER = 10
// One door opening per key every 5 seconds, at most 30 in any hour.
const MIN_GAP_SECONDS = 5
const PER_HOUR = 30

// Door admins kept the power to list and revoke anyone's door tokens.
const keyAdmin = async (actor: Actor) =>
  (await isAdmin(actor, "portal")) || (await isAdmin(actor, "door"))

const hash = (token: string) => createHash("sha256").update(token).digest("hex")

export const listApiKeys = defineAction({
  name: "list_api_keys",
  title: "API 金鑰",
  description:
    "The signed-in member's active API keys: id, name, the apps each may use, the first characters of the key, when it was made and last used. Never the key itself. all=true lists every member's active keys with the owner's name, for portal and door admins only.",
  kind: "query",
  input: z.object({ all: z.boolean().default(false) }),
  run: async (actor, { all }) => {
    if (all && !(await keyAdmin(actor)))
      throw new Error("只有 Portal 或門禁管理員能看所有人的金鑰")
    const keys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        apps: apiKeys.apps,
        prefix: apiKeys.prefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        userId: apiKeys.userId,
        owner: user.name,
      })
      .from(apiKeys)
      .innerJoin(user, eq(user.id, apiKeys.userId))
      .where(
        and(
          isNull(apiKeys.revokedAt),
          all ? undefined : eq(apiKeys.userId, actor.userId)
        )
      )
      .orderBy(desc(apiKeys.createdAt))
    return { keys }
  },
})

export const createApiKey = defineAction({
  name: "create_api_key",
  title: "建立 API 金鑰",
  description:
    "Makes an API key for the signed-in member, allowed into the given apps, and returns it once; only its hash is kept.",
  kind: "mutation",
  mcpExcludedBecause:
    "the key acts as the member and is shown once; a member makes it on /api-keys so it never passes through an agent's context",
  input: z.object({
    name: z.string().trim().min(1, "請填名稱").max(60, "名稱最多 60 字"),
    apps: z
      .array(z.enum(apiAppKeys))
      .min(1, "至少選一個 app")
      .transform((apps) => [...new Set(apps)]),
  }),
  run: async (actor, { name, apps }) => {
    const token = PREFIX + randomBytes(32).toString("base64url")
    return db.transaction(async (tx) => {
      // Serialises a member's creations so the cap holds.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('api_keys'), hashtext(${actor.userId}))`
      )
      const [{ active }] = await tx
        .select({ active: count() })
        .from(apiKeys)
        .where(and(eq(apiKeys.userId, actor.userId), isNull(apiKeys.revokedAt)))
      if (active >= MAX_PER_MEMBER)
        throw new Error(`每人最多 ${MAX_PER_MEMBER} 把金鑰，先撤銷不用的`)
      const [created] = await tx
        .insert(apiKeys)
        .values({
          userId: actor.userId,
          name,
          apps,
          tokenHash: hash(token),
          prefix: token.slice(0, PREFIX.length + 6),
        })
        .returning({ id: apiKeys.id, name: apiKeys.name })
      return { ...created, token }
    })
  },
})

export const revokeApiKey = defineAction({
  name: "revoke_api_key",
  title: "撤銷 API 金鑰",
  description:
    "Revokes one API key by id so it can no longer be used. A member revokes their own; a portal or door admin can revoke anyone's, so a leaked door key can be stopped. Fails when the key is not found or already revoked.",
  kind: "mutation",
  input: z.object({ id: z.uuid() }),
  run: async (actor, { id }) => {
    const admin = await keyAdmin(actor)
    const [revoked] = await db
      .update(apiKeys)
      .set({ revokedAt: new Date(), revokedBy: actor.userId })
      .where(
        and(
          eq(apiKeys.id, id),
          isNull(apiKeys.revokedAt),
          admin ? undefined : eq(apiKeys.userId, actor.userId)
        )
      )
      .returning({ id: apiKeys.id, name: apiKeys.name })
    if (!revoked) throw new Error("找不到這把金鑰")
    return revoked
  },
})

export type ApiKeyCheck =
  | { ok: true; userId: string; keyId: string; apps: ApiApp[] }
  | { ok: false; status: 401 | 403 | 503; error: string }

/** Checks a bearer key for the HTTP API. Not an action: the caller has no
 * session yet. Membership is checked as for MCP (cached for minutes); the
 * door asks again, uncached, in claimDoorOpening. */
export async function checkApiKey(
  token: string,
  { touch = true }: { touch?: boolean } = {}
): Promise<ApiKeyCheck> {
  const unauthorized = {
    ok: false,
    status: 401,
    error: "invalid or revoked key",
  } as const
  if (!TOKEN.test(token)) return unauthorized
  const live = and(
    eq(apiKeys.tokenHash, hash(token)),
    isNull(apiKeys.revokedAt)
  )
  const columns = { id: apiKeys.id, userId: apiKeys.userId, apps: apiKeys.apps }
  const [row] = touch
    ? await db
        .update(apiKeys)
        .set({ lastUsedAt: sql`now()` })
        .where(live)
        .returning(columns)
    : await db.select(columns).from(apiKeys).where(live).limit(1)
  if (!row) return unauthorized
  try {
    if (!(await isLabMember(row.userId)))
      return { ok: false, status: 403, error: "not a lab member" }
  } catch {
    return { ok: false, status: 503, error: "cannot confirm membership now" }
  }
  return {
    ok: true,
    userId: row.userId,
    keyId: row.id,
    apps: row.apps.filter((app): app is ApiApp =>
      (apiAppKeys as string[]).includes(app)
    ),
  }
}

/** A refusal the HTTP API answers with its own status (and Retry-After). */
export class ApiRefusal extends Error {
  constructor(
    readonly status: 401 | 403 | 429 | 503,
    message: string,
    readonly retryAfter?: number
  ) {
    super(message)
  }
}

/** Before a key opens the door (open_door with via api): asks Keycloak
 * again, uncached, and claims this opening's slot in the key's rate limit.
 * Throws ApiRefusal when it may not open now. */
export async function claimDoorOpening(keyId: string, userId: string) {
  let member: boolean
  try {
    member = await isLabMemberNow(userId)
  } catch {
    throw new ApiRefusal(503, "cannot confirm membership now")
  }
  if (!member) throw new ApiRefusal(403, "not a lab member")

  // One statement checks both limits and claims the slot, so calls that
  // arrive together, or while the relay is slow, cannot share one. A call
  // waiting on the row lock checks again against the row it then sees.
  const recent = sql`array(select t from unnest(${apiKeys.recentOpenings}) t where t >= now() - interval '1 hour')`
  const [claimed] = await db
    .update(apiKeys)
    .set({
      lastOpenedAt: sql`now()`,
      recentOpenings: sql`array_append(${recent}, now())`,
    })
    .where(
      and(
        eq(apiKeys.id, keyId),
        isNull(apiKeys.revokedAt),
        or(
          isNull(apiKeys.lastOpenedAt),
          lt(
            apiKeys.lastOpenedAt,
            sql`now() - make_interval(secs => ${MIN_GAP_SECONDS})`
          )
        ),
        sql`cardinality(${recent}) < ${PER_HOUR}`
      )
    )
    .returning({ id: apiKeys.id })
  if (claimed) return
  const [state] = await db
    .select({
      revoked: sql<boolean>`${apiKeys.revokedAt} is not null`,
      full: sql<boolean>`cardinality(${recent}) >= ${PER_HOUR}`,
      // When the oldest opening of the hour leaves the window.
      resetIn: sql<number>`greatest(1, ceil(extract(epoch from (select min(t) from unnest(${recent}) t) + interval '1 hour' - now())))::int`,
    })
    .from(apiKeys)
    .where(eq(apiKeys.id, keyId))
  if (!state || state.revoked)
    throw new ApiRefusal(401, "invalid or revoked key")
  throw state.full
    ? new ApiRefusal(
        429,
        `at most ${PER_HOUR} openings an hour per key`,
        state.resetIn
      )
    : new ApiRefusal(
        429,
        `one opening every ${MIN_GAP_SECONDS} seconds per key`,
        MIN_GAP_SECONDS
      )
}
