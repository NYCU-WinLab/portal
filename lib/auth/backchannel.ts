import { and, eq } from "drizzle-orm"
import { createRemoteJWKSet, jwtVerify } from "jose"

import { db } from "@/lib/db"
import { account, session } from "@/lib/db/schema"

// OIDC back-channel logout: when a Keycloak session ends (the member signs
// out of Keycloak or another app on it, or an admin ends their sessions),
// Keycloak posts a signed logout token here and the portal ends the
// member's web sessions at once. MCP and API keys are not sessions: they
// stop only when the member leaves the lab (lib/auth/member.ts).

const EVENT = "http://schemas.openid.net/event/backchannel-logout"

let keys: ReturnType<typeof createRemoteJWKSet> | null = null

/** A logout token Keycloak did not sign for this client, or a malformed one. */
export class BadLogoutToken extends Error {}

/** Verifies a logout token and ends its member's portal sessions; returns
 * how many ended. */
export async function backchannelLogout(token: string) {
  const issuer = process.env.KEYCLOAK_ISSUER
  if (!issuer) throw new Error("KEYCLOAK_ISSUER is not set")
  keys ??= createRemoteJWKSet(
    new URL(`${issuer}/protocol/openid-connect/certs`)
  )
  const { payload } = await jwtVerify(token, keys, {
    issuer,
    audience: process.env.KEYCLOAK_CLIENT_ID,
    maxTokenAge: "5m",
  }).catch((error: unknown) => {
    throw new BadLogoutToken(
      error instanceof Error ? error.message : "invalid logout token"
    )
  })
  const events = payload.events as Record<string, unknown> | undefined
  if (!events || typeof events !== "object" || !(EVENT in events))
    throw new BadLogoutToken("not a back-channel logout event")
  // A logout token must not look like an ID token.
  if ("nonce" in payload) throw new BadLogoutToken("logout token has a nonce")
  if (!payload.sub) throw new BadLogoutToken("logout token names no subject")
  const [link] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(
      and(
        eq(account.providerId, "keycloak"),
        eq(account.accountId, payload.sub)
      )
    )
  if (!link) return 0
  const ended = await db
    .delete(session)
    .where(eq(session.userId, link.userId))
    .returning({ id: session.id })
  return ended.length
}
