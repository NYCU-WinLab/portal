// Reads Keycloak with the portal client's own service account, which holds
// only realm-management view-users: it can look members up, never change
// them. Members change their account in Keycloak's account console.

import type { Email, Username } from "@/lib/applications/domain/values"
import {
  KeycloakUnavailable,
  type KeycloakDirectory,
} from "@/lib/applications/ports"
import { traced } from "@/lib/otel"

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

/**
 * Whether a member (by Keycloak id, the OIDC sub) is in a project group
 * right now: read live, never cached, for deciding a write.
 */
export async function inProjectGroup(sub: string, groupName: string) {
  const paths = await getKeycloakUserGroupPaths(sub)
  return paths.includes(`/winlab-projects/${groupName}`)
}

/**
 * The full paths (`/lab-member/114`) of every group a member (by Keycloak id,
 * the OIDC sub) is directly in, read live.
 */
export async function getKeycloakUserGroupPaths(sub: string) {
  const groups = await adminGet<{ path?: string }[]>(
    `/users/${encodeURIComponent(sub)}/groups?max=500&briefRepresentation=true`
  )
  return groups.flatMap((g) => (g.path ? [g.path] : []))
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
          attributes?: Record<string, string[]>
        }[]
      >(`/groups/${group.id}/members?max=1000&briefRepresentation=false`)
      const members: ProjectGroup["members"] = []
      const unmailable: string[] = []
      for (const person of people) {
        const name = displayName(person)
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
            attributes?: Record<string, string[]>
          }[]
        >(`/groups/${group.id}/members?max=1000&briefRepresentation=false`)
        return {
          name: group.name,
          members: people.map((p): KeycloakGroupMember => ({
            id: p.id,
            email: p.email ?? null,
            name: displayName(p),
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

let accounts: { list: RealmAccount[]; at: number } | null = null

/**
 * Ids in the realm's /system group: accounts that are not people (shared,
 * bot and test accounts). They carry real groups and attributes, so
 * Keycloak marks them here instead of the portal guessing from a username.
 */
let system: { ids: Set<string>; at: number } | null = null

export async function systemAccountIds(): Promise<Set<string>> {
  if (system && Date.now() - system.at < LAB_DIRECTORY_TTL_MS) return system.ids
  const group = await adminGet<{ id: string }>("/group-by-path/system")
  const people = await adminGet<{ id: string }[]>(
    `/groups/${group.id}/members?max=1000&briefRepresentation=true`
  )
  system = { ids: new Set(people.map(({ id }) => id)), at: Date.now() }
  return system.ids
}

let systemNames: { names: Set<string>; at: number } | null = null

/** Lowercase usernames of the /system group's accounts, for reserved names. */
export async function systemAccountUsernames(): Promise<Set<string>> {
  if (systemNames && Date.now() - systemNames.at < LAB_DIRECTORY_TTL_MS)
    return systemNames.names
  const group = await adminGet<{ id: string }>("/group-by-path/system")
  const people = await adminGet<{ username: string }[]>(
    `/groups/${group.id}/members?max=1000&briefRepresentation=true`
  )
  systemNames = {
    names: new Set(people.map((p) => p.username.toLowerCase())),
    at: Date.now(),
  }
  return systemNames.names
}

/**
 * Every enabled account in the realm except those in /system, with each
 * attribute's first value. Most alumni are in no /lab-member group, so the
 * member directory starts here, not from labDirectory(). Cached 10 minutes.
 */
export async function realmAccounts(): Promise<RealmAccount[]> {
  if (accounts && Date.now() - accounts.at < LAB_DIRECTORY_TTL_MS)
    return accounts.list
  const [system, users] = await Promise.all([
    systemAccountIds(),
    adminGet<
      (Omit<RealmAccount, "attributes"> & {
        enabled?: boolean
        attributes?: Record<string, string[]>
      })[]
    >("/users?max=5000&briefRepresentation=false"),
  ])
  // Keycloak ignores enabled=true on this endpoint, so filter here.
  const list = users
    .filter((u) => u.enabled && !system.has(u.id))
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

/** The name members see across the portal: the Chinese name when set. */
function displayName(person: {
  username: string
  firstName?: string
  lastName?: string
  attributes?: Record<string, string[]>
}) {
  return (
    person.attributes?.chinese_name?.[0]?.trim() ||
    [person.firstName, person.lastName].filter(Boolean).join(" ") ||
    person.username
  )
}

type Span = <T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>
) => Promise<T>

type Fetch = (url: string, init: RequestInit) => Promise<Response>

/**
 * The fetch under Next's patch, looked up on each call because Next patches
 * fetch per request, after this module loads. Next's patched fetch records
 * the full URL, query included, in its own span, and these queries carry an
 * applicant's email or username. Next keeps the fetch it wrapped on
 * `_nextOriginalFetch` (node_modules/next/dist/server/lib/patch-fetch.js).
 * @vercel/otel's fetch span is turned off for these URLs in
 * instrumentation.ts.
 */
const unpatchedFetch: Fetch = (url, init) => {
  const f = globalThis.fetch as typeof globalThis.fetch & {
    _nextOriginalFetch?: typeof globalThis.fetch
  }
  return (f._nextOriginalFetch ?? f)(url, init)
}

/**
 * A read-only client of the realm for the account application: its own
 * token per instance, one retry after a 401, and every HTTP call in a span
 * named by method and path (never the query, which carries the email or
 * username being looked up). A 5xx, a timeout or a dropped connection throws
 * KeycloakUnavailable; any other unexpected answer throws a plain Error.
 */
export class KeycloakAdmin implements KeycloakDirectory {
  private token: { value: string; expires: number } | null = null
  private readonly timeoutMs: number
  private readonly http: Fetch
  private readonly span: Span
  private readonly base: string

  constructor(
    private readonly config: {
      issuer: string
      clientId: string
      clientSecret: string
      timeoutMs?: number
      fetch?: typeof globalThis.fetch
      span?: Span
    }
  ) {
    this.timeoutMs = config.timeoutMs ?? 5000
    this.http = config.fetch ?? unpatchedFetch
    this.span = config.span ?? traced
    this.base = config.issuer.replace("/realms/", "/admin/realms/")
  }

  forgetCaches(): void {
    this.token = null
  }

  async emailExists(email: Email): Promise<boolean> {
    const found = await this.get<{ email?: string }[]>(
      "/users",
      new URLSearchParams({ email: email.value, exact: "true" })
    )
    // Keycloak stores emails lowercase, but match on the answer, not on that.
    return (found ?? []).some((u) => u.email?.toLowerCase() === email.value)
  }

  async usernamesTaken(names: readonly Username[]): Promise<Set<string>> {
    const taken = new Set<string>()
    await Promise.all(
      names.map(async (name) => {
        const wanted = name.value.toLowerCase()
        const found = await this.get<{ username?: string }[]>(
          "/users",
          new URLSearchParams({ username: wanted, exact: "true" })
        )
        if ((found ?? []).some((u) => u.username?.toLowerCase() === wanted))
          taken.add(wanted)
      })
    )
    return taken
  }

  async groupExists(path: string): Promise<boolean> {
    const segments = path.split("/").filter(Boolean).map(encodeURIComponent)
    const found = await this.get<unknown>(
      `/group-by-path/${segments.join("/")}`,
      undefined,
      true
    )
    return found !== null
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 10_000)
      return this.token.value
    const path = "/protocol/openid-connect/token"
    const response = await this.call("POST", this.config.issuer + path, path, {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    })
    if (!response.ok) throw new Error(`Keycloak token ${response.status}`)
    const body = (await response.json()) as {
      access_token: string
      expires_in: number
    }
    this.token = {
      value: body.access_token,
      expires: Date.now() + body.expires_in * 1000,
    }
    return this.token.value
  }

  /** GET an admin path; null on 404 when `missingIsNull`. */
  private async get<T>(
    path: string,
    query?: URLSearchParams,
    missingIsNull = false
  ): Promise<T | null> {
    const url = `${this.base}${path}${query ? `?${query}` : ""}`
    const send = async () =>
      this.call("GET", url, path, {
        headers: { authorization: `Bearer ${await this.accessToken()}` },
      })
    let response = await send()
    // A token Keycloak dropped early: fetch a new one, once.
    if (response.status === 401) {
      this.token = null
      response = await send()
    }
    if (response.status === 404 && missingIsNull) return null
    if (!response.ok) throw new Error(`Keycloak ${path} ${response.status}`)
    return (await response.json()) as T
  }

  /** One HTTP call in a span; 5xx, timeout and network errors are Unavailable. */
  private call(
    method: string,
    url: string,
    path: string,
    init: RequestInit
  ): Promise<Response> {
    return this.span(
      `keycloak ${method} ${path}`,
      { "http.request.method": method, "url.path": path },
      async () => {
        let response: Response
        try {
          response = await this.http(url, {
            ...init,
            method,
            cache: "no-store",
            signal: AbortSignal.timeout(this.timeoutMs),
          })
        } catch {
          throw new KeycloakUnavailable(
            `Keycloak ${method} ${path} unreachable`
          )
        }
        if (response.status >= 500)
          throw new KeycloakUnavailable(
            `Keycloak ${method} ${path} ${response.status}`
          )
        return response
      }
    )
  }
}

const readerKey = Symbol.for("portal.keycloakReader")

/** The portal client's reader, made on first use and kept across reloads. */
export function keycloakReader(): KeycloakAdmin {
  const store = globalThis as unknown as Record<symbol, KeycloakAdmin>
  return (store[readerKey] ??= new KeycloakAdmin({
    issuer: issuer(),
    clientId: process.env.KEYCLOAK_CLIENT_ID!,
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
  }))
}

/** Clears this module's caches and the reader's token. */
export function forgetDirectoryCaches(): void {
  cached = null
  directory = null
  projects = null
  accounts = null
  system = null
  systemNames = null
  const store = globalThis as unknown as Record<symbol, KeycloakAdmin>
  store[readerKey]?.forgetCaches()
}
