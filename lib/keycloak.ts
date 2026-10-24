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
export type LabMember = { status?: LabStatus; cohort?: number; email?: string }

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
    const people = await adminGet<{ id: string; email?: string }[]>(
      `/groups/${group.id}/members?max=1000&briefRepresentation=true`
    )
    for (const { id, email } of people) {
      const member = members.get(id) ?? {}
      if (email) member.email = email
      if (status) member.status = status
      if (cohort !== undefined) member.cohort = cohort
      members.set(id, member)
    }
  }
  directory = { members, at: Date.now() }
  return members
}

export type ProjectGroup = {
  /** The slug, e.g. "tasa-satsim": the Teams topic prefix. */
  name: string
  /** What people call it, when the group has a description. */
  label: string
  /** The GitLab group path (the gitlab_path attribute), when linked. */
  gitlabPath: string | null
  members: { name: string; email: string; username: string }[]
  /** Members Keycloak has no email for, who cannot be invited. */
  unmailable: string[]
}

type RawGroup = {
  id: string
  name: string
  description?: string
  attributes?: Record<string, string[]>
}

let projects: { groups: ProjectGroup[]; at: number } | null = null

/**
 * The project groups under /winlab-projects, with their members, for
 * inviting a whole project to a meeting. Read live, cached for 10 minutes.
 */
export async function projectGroups(): Promise<ProjectGroup[]> {
  if (projects && Date.now() - projects.at < LAB_DIRECTORY_TTL_MS)
    return projects.groups
  const root = await adminGet<{ id: string }>("/group-by-path/winlab-projects")
  const children = await adminGet<RawGroup[]>(
    `/groups/${root.id}/children?max=500&briefRepresentation=false`
  )
  const groups = await Promise.all(
    children.map(async (group) => {
      // The full representation is what carries each member's email.
      const people = await adminGet<
        {
          username: string
          email?: string
          firstName?: string
          lastName?: string
        }[]
      >(`/groups/${group.id}/members?max=1000&briefRepresentation=false`)
      const members: ProjectGroup["members"] = []
      const unmailable: string[] = []
      for (const person of people) {
        const name =
          [person.firstName, person.lastName].filter(Boolean).join(" ") ||
          person.username
        if (person.email)
          members.push({ name, email: person.email, username: person.username })
        else unmailable.push(name)
      }
      return {
        name: group.name,
        label:
          group.description?.trim() ||
          group.attributes?.description?.[0]?.trim() ||
          group.name,
        gitlabPath: group.attributes?.gitlab_path?.[0]?.trim() || null,
        members,
        unmailable,
      }
    })
  )
  groups.sort((a, b) => a.name.localeCompare(b.name))
  projects = { groups, at: Date.now() }
  return groups
}

/** A member of a Keycloak group, as /groups invites them. */
export type KeycloakGroupMember = {
  id: string
  email: string | null
  name: string | null
  username: string | null
}

/**
 * The cohort groups under /lab-member (114, 113, …), newest first, each
 * with its members, for adding a whole cohort to a mailing list.
 */
export async function labCohorts() {
  const root = await adminGet<{ id: string }>("/group-by-path/lab-member")
  const groups = await adminGet<{ id: string; name: string }[]>(
    `/groups/${root.id}/children?max=200&briefRepresentation=true`
  )
  const cohorts = await Promise.all(
    groups
      .filter((group) => /^\d{3}$/.test(group.name))
      .map(async (group) => {
        const people = await adminGet<
          {
            id: string
            username: string
            email?: string
            firstName?: string
            lastName?: string
          }[]
        >(`/groups/${group.id}/members?max=1000&briefRepresentation=false`)
        return {
          name: group.name,
          members: people.map((p): KeycloakGroupMember => ({
            id: p.id,
            email: p.email ?? null,
            name:
              [p.firstName, p.lastName].filter(Boolean).join(" ") || p.username,
            username: p.username,
          })),
        }
      })
  )
  return cohorts.sort((a, b) => b.name.localeCompare(a.name))
}

/** The groups one member is in, by their Keycloak id. */
export async function keycloakUserGroups(sub: string) {
  const groups: { name: string; path: string }[] = []
  for (let first = 0; ; first += 100) {
    const page = await adminGet<{ name: string; path: string }[]>(
      `/users/${encodeURIComponent(sub)}/groups?first=${first}&max=100`
    )
    groups.push(...page)
    if (page.length < 100) return groups
  }
}

/** One enabled realm account, as the member directory shows it. */
export type RealmAccount = {
  id: string
  username: string
  email?: string
  firstName?: string
  lastName?: string
  attributes: Record<string, string | undefined>
}

/**
 * Accounts that exist to try the lab's apps, not people: a "test" token in
 * the username (test, winlab-test-master). They carry real groups and
 * attributes, so the username is the one thing that sets them apart.
 */
const TEST_ACCOUNT = /(^|[-_.])test([-_.]|$)/i

let accounts: { list: RealmAccount[]; at: number } | null = null

/**
 * Every enabled account in the realm except test accounts, with each
 * attribute's first value. Most alumni are in no /lab-member group, so the
 * member directory starts here, not from labDirectory(). Cached 10 minutes.
 */
export async function realmAccounts(): Promise<RealmAccount[]> {
  if (accounts && Date.now() - accounts.at < LAB_DIRECTORY_TTL_MS)
    return accounts.list
  const users = await adminGet<
    (Omit<RealmAccount, "attributes"> & {
      enabled?: boolean
      attributes?: Record<string, string[]>
    })[]
  >("/users?max=5000&briefRepresentation=false")
  // Keycloak ignores enabled=true on this endpoint, so filter here.
  const list = users
    .filter((u) => u.enabled && !TEST_ACCOUNT.test(u.username))
    .map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      attributes: Object.fromEntries(
        Object.entries(u.attributes ?? {}).map(([key, values]) => [
          key,
          values[0]?.trim() || undefined,
        ])
      ),
    }))
  accounts = { list, at: Date.now() }
  return list
}
