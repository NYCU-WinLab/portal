import { createHash, randomBytes } from "node:crypto"

import { and, count, desc, eq, isNull, lt, or, sql } from "drizzle-orm"
import { z } from "zod"

import { isAdmin, requireAdmin } from "@/lib/actions/authz"
import { defineAction } from "@/lib/actions/define"
import { isLabMemberNow } from "@/lib/auth/member"
import { db } from "@/lib/db"
import { doorTokens, user } from "@/lib/db/schema"

// Door tokens open the door through POST /api/door/open, and nothing else.
// A token is "wdt_" and 43 base64url characters (32 random bytes); only its
// SHA-256 is stored. It has no expiry: it works until its owner or a door
// admin revokes it, or the owner leaves the lab: every call asks Keycloak,
// uncached, and refuses when Keycloak does not answer.

const PREFIX = "wdt_"
const TOKEN = /^wdt_[A-Za-z0-9_-]{43}$/
const MAX_PER_MEMBER = 10
// One opening per token every 5 seconds, at most 30 in an hour-long window.
const MIN_GAP_SECONDS = 5
const PER_HOUR = 30

const hash = (token: string) => createHash("sha256").update(token).digest("hex")

export const listDoorTokens = defineAction({
  name: "list_door_tokens",
  title: "開門金鑰",
  description:
    "The signed-in member's active door tokens (keys for POST /api/door/open): id, name, the first characters of the token, when it was made and last used. Never the token itself. all=true lists every member's active tokens with the owner's name, for door admins only.",
  kind: "query",
  input: z.object({ all: z.boolean().default(false) }),
  run: async (actor, { all }) => {
    if (all) await requireAdmin(actor, "door")
    const tokens = await db
      .select({
        id: doorTokens.id,
        name: doorTokens.name,
        prefix: doorTokens.prefix,
        createdAt: doorTokens.createdAt,
        lastUsedAt: doorTokens.lastUsedAt,
        userId: doorTokens.userId,
        owner: user.name,
      })
      .from(doorTokens)
      .innerJoin(user, eq(user.id, doorTokens.userId))
      .where(
        and(
          isNull(doorTokens.revokedAt),
          all ? undefined : eq(doorTokens.userId, actor.userId)
        )
      )
      .orderBy(desc(doorTokens.createdAt))
    return { tokens }
  },
})

export const createDoorToken = defineAction({
  name: "create_door_token",
  title: "建立開門金鑰",
  description:
    "Makes a door token for the signed-in member and returns it once; only its hash is kept.",
  kind: "mutation",
  mcpExcludedBecause:
    "the token opens the lab door and is shown once; a member makes it on /door/tokens so it never passes through an agent's context",
  input: z.object({
    name: z.string().trim().min(1, "請填名稱").max(60, "名稱最多 60 字"),
  }),
  run: async (actor, { name }) => {
    const token = PREFIX + randomBytes(32).toString("base64url")
    return db.transaction(async (tx) => {
      // Serialises a member's creations so the cap holds.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('door_tokens'), hashtext(${actor.userId}))`
      )
      const [{ active }] = await tx
        .select({ active: count() })
        .from(doorTokens)
        .where(
          and(eq(doorTokens.userId, actor.userId), isNull(doorTokens.revokedAt))
        )
      if (active >= MAX_PER_MEMBER)
        throw new Error(`每人最多 ${MAX_PER_MEMBER} 把金鑰，先撤銷不用的`)
      const [created] = await tx
        .insert(doorTokens)
        .values({
          userId: actor.userId,
          name,
          tokenHash: hash(token),
          prefix: token.slice(0, PREFIX.length + 6),
        })
        .returning({ id: doorTokens.id, name: doorTokens.name })
      return { ...created, token }
    })
  },
})

export const revokeDoorToken = defineAction({
  name: "revoke_door_token",
  title: "撤銷開門金鑰",
  description:
    "Revokes one door token by id so it can no longer open the door. A member revokes their own; a door admin can revoke anyone's. Fails when the token is not found or already revoked.",
  kind: "mutation",
  input: z.object({ id: z.uuid() }),
  run: async (actor, { id }) => {
    const admin = await isAdmin(actor, "door")
    const [revoked] = await db
      .update(doorTokens)
      .set({ revokedAt: new Date(), revokedBy: actor.userId })
      .where(
        and(
          eq(doorTokens.id, id),
          isNull(doorTokens.revokedAt),
          admin ? undefined : eq(doorTokens.userId, actor.userId)
        )
      )
      .returning({ id: doorTokens.id, name: doorTokens.name })
    if (!revoked) throw new Error("找不到這把金鑰")
    return revoked
  },
})

export type DoorTokenCheck =
  | { ok: true; userId: string; tokenId: string }
  | { ok: false; status: 401 | 403 | 503; error: string }
  | { ok: false; status: 429; error: string; retryAfter: number }

/** Checks a bearer token for POST /api/door/open and claims this call's
 * slot in its rate limit. Not an action: the caller has no session yet. */
export async function checkDoorToken(token: string): Promise<DoorTokenCheck> {
  const unauthorized = {
    ok: false,
    status: 401,
    error: "invalid or revoked token",
  } as const
  if (!TOKEN.test(token)) return unauthorized
  const [row] = await db
    .select({ id: doorTokens.id, userId: doorTokens.userId })
    .from(doorTokens)
    .where(
      and(eq(doorTokens.tokenHash, hash(token)), isNull(doorTokens.revokedAt))
    )
  if (!row) return unauthorized
  let member: boolean
  try {
    member = await isLabMemberNow(row.userId)
  } catch {
    return { ok: false, status: 503, error: "cannot confirm membership now" }
  }
  if (!member) return { ok: false, status: 403, error: "not a lab member" }

  // One statement checks both limits and claims the slot, so calls that
  // arrive together, or while the relay is slow, cannot share one.
  const fresh = sql`(${doorTokens.windowStartedAt} is null or ${doorTokens.windowStartedAt} <= now() - interval '1 hour')`
  const [claimed] = await db
    .update(doorTokens)
    .set({
      lastUsedAt: sql`now()`,
      windowStartedAt: sql`case when ${fresh} then now() else ${doorTokens.windowStartedAt} end`,
      windowCount: sql`case when ${fresh} then 1 else ${doorTokens.windowCount} + 1 end`,
    })
    .where(
      and(
        eq(doorTokens.id, row.id),
        isNull(doorTokens.revokedAt),
        or(
          isNull(doorTokens.lastUsedAt),
          lt(
            doorTokens.lastUsedAt,
            sql`now() - make_interval(secs => ${MIN_GAP_SECONDS})`
          )
        ),
        or(fresh, lt(doorTokens.windowCount, PER_HOUR))
      )
    )
    .returning({ id: doorTokens.id })
  if (!claimed) {
    const [state] = await db
      .select({
        full: sql<boolean>`not ${fresh} and ${doorTokens.windowCount} >= ${PER_HOUR}`,
        resetIn: sql<number>`greatest(1, ceil(extract(epoch from ${doorTokens.windowStartedAt} + interval '1 hour' - now())))::int`,
      })
      .from(doorTokens)
      .where(eq(doorTokens.id, row.id))
    if (!state) return unauthorized
    return state.full
      ? {
          ok: false,
          status: 429,
          error: `at most ${PER_HOUR} openings an hour per token`,
          retryAfter: state.resetIn,
        }
      : {
          ok: false,
          status: 429,
          error: `one opening every ${MIN_GAP_SECONDS} seconds per token`,
          retryAfter: MIN_GAP_SECONDS,
        }
  }
  return { ok: true, userId: row.userId, tokenId: row.id }
}
