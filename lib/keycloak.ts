// Reads Keycloak with the portal client's own service account, which holds
// only realm-management view-users: it can look members up, never change
// them. Members change their account in Keycloak's account console.

const issuer = () => process.env.KEYCLOAK_ISSUER!
const timeout = () => AbortSignal.timeout(5000)
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
    signal: timeout(),
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
  enabled?: boolean
  email?: string
  firstName?: string
  lastName?: string
  attributes?: Record<string, string[]>
}

/** One member's Keycloak record, by their Keycloak id (the OIDC sub). */
export async function getKeycloakUser(sub: string): Promise<KeycloakUser> {
  const user = await findKeycloakUser(sub)
  if (!user) throw new Error("Keycloak user 404")
  return user
}

/** Like getKeycloakUser, but null when Keycloak no longer has the account. */
export async function findKeycloakUser(
  sub: string
): Promise<KeycloakUser | null> {
  const url = `${issuer().replace("/realms/", "/admin/realms/")}/users/${encodeURIComponent(sub)}`
  const get = async () =>
    fetch(url, {
      headers: { authorization: `Bearer ${await adminToken()}` },
      cache: "no-store",
      signal: timeout(),
    })
  let response = await get()
  // A token Keycloak dropped early (restart, revocation): fetch a new one once.
  if (response.status === 401) {
    cached = null
    response = await get()
  }
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Keycloak user ${response.status}`)
  return (await response.json()) as KeycloakUser
}

/** Where a member edits their own Keycloak account. */
export const accountConsoleUrl = () => `${issuer()}/account`

export const labStatuses = [
  "teacher",
  "assistant",
  "doctoral",
  "master",
  "undergrad",
  "alumni",
] as const
export type LabStatus = (typeof labStatuses)[number]
export type LabMember = { status?: LabStatus; cohort?: number }

const LAB_DIRECTORY_TTL_MS = 10 * 60 * 1000
let directory: { members: Map<string, LabMember>; at: number } | null = null

async function adminGet<T>(path: string): Promise<T> {
  const url = `${issuer().replace("/realms/", "/admin/realms/")}${path}`
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${await adminToken()}` },
    cache: "no-store",
    signal: timeout(),
  })
  if (!response.ok) throw new Error(`Keycloak ${path} ${response.status}`)
  return (await response.json()) as T
}

/**
 * Status and cohort of everyone in the realm's /lab-member groups, by
 * Keycloak id: /lab-member/master gives the status, /lab-member/114 the
 * cohort (民國 admission year). Read live, cached for 10 minutes, so
 * nothing copies these into the database to drift.
 */
export async function labDirectory(): Promise<Map<string, LabMember>> {
  if (directory && Date.now() - directory.at < LAB_DIRECTORY_TTL_MS)
    return directory.members
  const root = await adminGet<{ id: string }>("/group-by-path/lab-member")
  const groups = await adminGet<{ id: string; name: string }[]>(
    `/groups/${root.id}/children?max=200&briefRepresentation=true`
  )
  const members = new Map<string, LabMember>()
  for (const group of groups) {
    const status = labStatuses.find((name) => name === group.name)
    const cohort = /^\d{3}$/.test(group.name) ? Number(group.name) : undefined
    if (!status && cohort === undefined) continue
    const people = await adminGet<{ id: string }[]>(
      `/groups/${group.id}/members?max=1000&briefRepresentation=true`
    )
    for (const { id } of people) {
      const member = members.get(id) ?? {}
      if (status) member.status = status
      if (cohort !== undefined) member.cohort = cohort
      members.set(id, member)
    }
  }
  directory = { members, at: Date.now() }
  return members
}
