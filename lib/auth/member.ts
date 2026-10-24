import { and, eq, gt } from "drizzle-orm"

import { db } from "@/lib/db"
import { account, oauthRefreshToken, session } from "@/lib/db/schema"
import { findKeycloakUser } from "@/lib/keycloak"

// MCP access tokens are JWTs checked against the JWKS alone, and refresh
// tokens keep renewing them, so leaving the lab would not end MCP access.
// /mcp asks this on every call instead: is the member still an enabled
// account in Keycloak (realm winlab)? Someone who left loses access within
// the cache window, and their refresh tokens and sessions are deleted so
// they cannot come back without signing in through Keycloak again.

const CHECK_EVERY_MS = 5 * 60 * 1000
// While Keycloak is unreachable, a member seen recently keeps access.
const TRUST_WHILE_DOWN_MS = 60 * 60 * 1000

const seen = new Map<string, { member: boolean; at: number }>()

async function lookup(userId: string) {
  const [link] = await db
    .select({ sub: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "keycloak")))
  const keycloakUser = link ? await findKeycloakUser(link.sub) : null
  return keycloakUser?.enabled === true
}

export async function isLabMember(userId: string): Promise<boolean> {
  const last = seen.get(userId)
  if (last && Date.now() - last.at < CHECK_EVERY_MS) return last.member

  let member: boolean
  try {
    member = await lookup(userId)
  } catch (error) {
    if (last?.member && Date.now() - last.at < TRUST_WHILE_DOWN_MS) return true
    throw error
  }
  await remember(userId, member)
  return member
}

/**
 * The same question for the physical door: asked of Keycloak every time,
 * with no cache and no grace while Keycloak is down (it throws then), so a
 * member disabled a second ago cannot open the door.
 */
export async function isLabMemberNow(userId: string): Promise<boolean> {
  const member = await lookup(userId)
  await remember(userId, member)
  return member
}

/**
 * Every few minutes: asks Keycloak about each member who has a live web
 * session, so someone removed or disabled there loses their sessions and
 * refresh tokens without waiting for their next /mcp call. Keycloak being
 * unreachable changes nothing; the next sweep asks again.
 */
export async function sweepMembers() {
  const live = await db
    .selectDistinct({ userId: session.userId })
    .from(session)
    .where(gt(session.expiresAt, new Date()))
  let ended = 0
  for (const { userId } of live) {
    const member = await isLabMemberNow(userId).catch(() => true)
    if (!member) ended++
  }
  return ended
}

/** Starts the sweep; called once per server process. */
export function startMemberSweep() {
  const run = () => void sweepMembers().catch(() => {})
  setInterval(run, CHECK_EVERY_MS).unref()
  run()
}

async function remember(userId: string, member: boolean) {
  seen.set(userId, { member, at: Date.now() })
  if (!member) {
    await db.transaction(async (tx) => {
      await tx
        .delete(oauthRefreshToken)
        .where(eq(oauthRefreshToken.userId, userId))
      await tx.delete(session).where(eq(session.userId, userId))
    })
  }
}
