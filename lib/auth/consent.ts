import { verifyOAuthQueryParams } from "@better-auth/oauth-provider"
import { eq } from "drizzle-orm"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { oauthClient } from "@/lib/db/schema"

/**
 * The client asking for access, from the consent page's signed query, or
 * null when the query was altered or has expired.
 */
export async function getConsentRequest(query: string) {
  const { secret } = await auth.$context
  if (!(await verifyOAuthQueryParams(query, secret))) return null
  const params = new URLSearchParams(query)
  const clientId = params.get("client_id")
  if (!clientId) return null
  const [client] = await db
    .select({ name: oauthClient.name, uri: oauthClient.uri })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
  return {
    clientId,
    name: client?.name || clientId,
    uri: client?.uri ?? null,
    scopes: (params.get("scope") ?? "").split(" ").filter(Boolean),
  }
}
