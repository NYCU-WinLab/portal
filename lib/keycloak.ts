// Reads Keycloak with the portal client's own service account, which holds
// only realm-management view-users: it can look members up, never change
// them. Members change their account in Keycloak's account console.

const issuer = () => process.env.KEYCLOAK_ISSUER!
let cached: { token: string; expires: number } | null = null

async function adminToken() {
  if (cached && cached.expires > Date.now() + 10_000) return cached.token
  const response = await fetch(`${issuer()}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.KEYCLOAK_CLIENT_ID!,
      client_secret: process.env.KEYCLOAK_CLIENT_SECRET!,
    }),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`Keycloak token ${response.status}`)
  const body = (await response.json()) as {
    access_token: string
    expires_in: number
  }
  cached = {
    token: body.access_token,
    expires: Date.now() + body.expires_in * 1000,
  }
  return cached.token
}

export type KeycloakUser = {
  username: string
  email?: string
  firstName?: string
  lastName?: string
  attributes?: Record<string, string[]>
}

/** One member's Keycloak record, by their Keycloak id (the OIDC sub). */
export async function getKeycloakUser(sub: string): Promise<KeycloakUser> {
  const admin = issuer().replace("/realms/", "/admin/realms/")
  const response = await fetch(`${admin}/users/${encodeURIComponent(sub)}`, {
    headers: { authorization: `Bearer ${await adminToken()}` },
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`Keycloak user ${response.status}`)
  return (await response.json()) as KeycloakUser
}

/** Where a member edits their own Keycloak account. */
export const accountConsoleUrl = () => `${issuer()}/account`
