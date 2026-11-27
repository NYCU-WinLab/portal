/**
 * Checks, against a disposable Keycloak test realm, every Keycloak behaviour
 * the provisioning worker relies on, then replays the keycloakContract
 * scenarios through KeycloakAdmin with the provisioner's own credentials and,
 * as in production, the portal client (KEYCLOAK_PROBE_READER_*) as its reader.
 * Prints one markdown table (item | check | result | actual response).
 *
 * Run it after scripts/keycloak-test-realm.ts; never against winlab. It reads
 * only KEYCLOAK_PROBE_* (never KEYCLOAK_ISSUER), refuses a realm whose name
 * does not end in `-test` and any host under winlab.tw, and cleans up with
 * probe-admin in a `finally`: every user named probe-*, plus the temporary
 * groups and permissions.
 *
 *   bun scripts/keycloak-probe.ts --env ~/work/tmp/…/keycloak-test.env --yes
 *
 * Mail goes to mailpit (KEYCLOAK_PROBE_MAILPIT_URL, default
 * http://127.0.0.1:18025), which the test realm's SMTP points at.
 */
import { readFileSync } from "node:fs"
import { KeycloakAdmin } from "@/lib/keycloak"
import { Email, Username } from "@/lib/applications/domain/values"
import type { NewKeycloakUser } from "@/lib/applications/ports"

// --- configuration -------------------------------------------------------

const args = process.argv.slice(2)
const envIndex = args.indexOf("--env")
const fileVars: Record<string, string> = {}
if (envIndex >= 0) {
  const path = args[envIndex + 1]
  if (!path) throw new Error("--env needs a file")
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line)
    if (m) fileVars[m[1]] = m[2].trim()
  }
}
const need = (name: string) => {
  const value = fileVars[name] ?? process.env[name]
  if (!value)
    throw new Error(`${name} is required (--env <file> or environment)`)
  return value
}

const issuer = need("KEYCLOAK_PROBE_ISSUER").replace(/\/$/, "")
const provisionerId = need("KEYCLOAK_PROBE_PROVISIONER_ID")
const provisionerSecret = need("KEYCLOAK_PROBE_PROVISIONER_SECRET")
const adminId = need("KEYCLOAK_PROBE_ADMIN_ID")
const adminSecret = need("KEYCLOAK_PROBE_ADMIN_SECRET")
const portalUrl = need("KEYCLOAK_PROBE_PORTAL_URL")
const mailpit = (
  fileVars.KEYCLOAK_PROBE_MAILPIT_URL ??
  process.env.KEYCLOAK_PROBE_MAILPIT_URL ??
  "http://127.0.0.1:18025"
).replace(/\/$/, "")

const realm = issuer.split("/realms/")[1] ?? ""
if (!realm.endsWith("-test"))
  throw new Error(`refusing realm "${realm}": the name must end in -test`)
if (/winlab\.tw/.test(new URL(issuer).hostname))
  throw new Error(`refusing ${issuer}: this probe is for a throwaway server`)
if (!args.includes("--yes"))
  throw new Error(
    `this creates and deletes probe-* users and groups in ${issuer}; pass --yes`
  )

const adminBase = issuer.replace(`/realms/${realm}`, "/admin/realms")
const rand = Math.random().toString(36).slice(2, 8)
const sig = () => AbortSignal.timeout(15_000)

// --- raw HTTP ------------------------------------------------------------

async function tokenFor(clientId: string, clientSecret: string) {
  const res = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: sig(),
  })
  if (!res.ok) throw new Error(`token for ${clientId}: ${res.status}`)
  return ((await res.json()) as { access_token: string }).access_token
}

type Raw = { status: number; text: string; location: string | null }
type Caller = (
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string>
) => Promise<Raw>

function caller(clientId: string, clientSecret: string): Caller {
  let token: string | null = null
  return async (method, path, body, query) => {
    token ??= await tokenFor(clientId, clientSecret)
    const qs = query ? `?${new URLSearchParams(query)}` : ""
    const res = await fetch(`${adminBase}${path}${qs}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: sig(),
    })
    return {
      status: res.status,
      text: await res.text(),
      location: res.headers.get("location"),
    }
  }
}

const admin = caller(adminId, adminSecret)
const provisioner = caller(provisionerId, provisionerSecret)

const json = <T>(r: Raw): T => JSON.parse(r.text) as T
const must = (r: Raw, ok: number[], what: string) => {
  if (!ok.includes(r.status))
    throw new Error(`${what}: ${r.status} ${r.text.slice(0, 200)}`)
  return r
}
const idOf = (r: Raw) => r.location?.split("/").pop() ?? ""
const brief = (r: Raw) =>
  `${r.status}${r.text ? ` ${r.text.replace(/\s+/g, " ").slice(0, 160)}` : ""}`

// --- results -------------------------------------------------------------

type Row = { item: string; check: string; pass: boolean | null; actual: string }
const rows: Row[] = []
const record = (
  item: string,
  check: string,
  pass: boolean | null,
  actual: string
) => rows.push({ item, check, pass, actual })
const expectStatus = (item: string, check: string, r: Raw, want: number) =>
  record(item, check, r.status === want, `${brief(r)} (want ${want})`)

async function section(item: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (error) {
    record(item, "probe error", false, String(error).slice(0, 300))
  }
}

// --- helpers on the realm -------------------------------------------------

const readerId =
  fileVars.KEYCLOAK_PROBE_READER_ID ?? process.env.KEYCLOAK_PROBE_READER_ID
const readerSecret =
  fileVars.KEYCLOAK_PROBE_READER_SECRET ??
  process.env.KEYCLOAK_PROBE_READER_SECRET
if (!readerId || !readerSecret)
  throw new Error("KEYCLOAK_PROBE_READER_ID and _SECRET are needed")
const reader = new KeycloakAdmin({
  issuer,
  clientId: readerId,
  clientSecret: readerSecret,
})
const readerCall = caller(readerId, readerSecret)

// As keycloakProvisioner() builds it: reads and "who is this 403 for" go
// through the portal client, because FGAP hides them from the provisioner.
const kc = new KeycloakAdmin({
  issuer,
  clientId: provisionerId,
  clientSecret: provisionerSecret,
  reader,
  actionsEmail: { clientId: "portal", redirectUri: portalUrl },
})

const names = {
  user: (tag: string) => `probe-${tag}-${rand}`,
  email: (tag: string) => `probe-${tag}-${rand}@example.com`,
}

const newUser = (tag: string, o: Partial<NewKeycloakUser> = {}) => ({
  username: names.user(tag),
  email: names.email(tag),
  firstName: "Probe",
  lastName: "User",
  attributes: { portal_application_id: [`app-${tag}-${rand}`] },
  groups: ["/provisioning"],
  ...o,
})

async function provisioned(tag: string, o: Partial<NewKeycloakUser> = {}) {
  const r = await kc.createUser(newUser(tag, o))
  if (!r.ok) throw new Error(`createUser ${tag}: ${r.reason}`)
  return r.id
}

const groupId = async (path: string) =>
  json<{ id: string }>(
    must(
      await admin("GET", `/${realm}/group-by-path/${path.replace(/^\//, "")}`),
      [200],
      `group ${path}`
    )
  ).id

let authzBase: string | null = null
async function authz() {
  if (authzBase) return authzBase
  const clients = json<{ id: string }[]>(
    must(
      await admin("GET", `/${realm}/clients`, undefined, {
        clientId: "admin-permissions",
      }),
      [200],
      "admin-permissions client"
    )
  )
  authzBase = `/${realm}/clients/${clients[0].id}/authz/resource-server`
  return authzBase
}

const trackedGroups: string[] = []

/** A scope permission for the provisioner's own policy, named probe-*. */
async function grant(name: string, groups: string[], scopes: string[]) {
  must(
    await admin("POST", `${await authz()}/permission/scope`, {
      name: `probe-${name}-${rand}`,
      resourceType: "Groups",
      resources: groups,
      scopes,
      policies: ["portal-provisioner"],
      decisionStrategy: "UNANIMOUS",
    }),
    [200, 201],
    `permission ${name}`
  )
}

// --- mailpit -------------------------------------------------------------

type Mail = { id: string; subject: string; text: string; html: string }
async function waitForMail(to: string, seconds = 20): Promise<Mail | null> {
  for (let i = 0; i < seconds * 2; i++) {
    const res = await fetch(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
      { signal: sig() }
    )
    const list = (await res.json()) as {
      messages?: { ID: string; Subject: string }[]
    }
    const hit = list.messages?.[0]
    if (hit) {
      const full = (await (
        await fetch(`${mailpit}/api/v1/message/${hit.ID}`, { signal: sig() })
      ).json()) as { Text?: string; HTML?: string }
      return {
        id: hit.ID,
        subject: hit.Subject,
        text: full.Text ?? "",
        html: full.HTML ?? "",
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

const linkIn = (mail: Mail) =>
  /https?:\/\/[^\s"'<>]+/
    .exec(mail.text + " " + mail.html)?.[0]
    ?.replace(/&amp;/g, "&")

/** A link's path and the query keys that matter, never the token itself. */
function describeLink(link: string) {
  const url = new URL(link)
  const q = url.searchParams
  return `${url.origin}${url.pathname} client_id=${q.get("client_id") ?? "(not in the url)"} redirect_uri=${q.get("redirect_uri") ?? "-"}`
}

// --- the items -----------------------------------------------------------

async function item1() {
  const base = {
    username: names.user("create-a"),
    email: names.email("create-a"),
    firstName: "Probe",
    lastName: "User",
    enabled: false,
  }
  const post = (o: object) => provisioner("POST", `/${realm}/users`, o)
  expectStatus(
    "1",
    `create with groups ["/provisioning"]`,
    await post({ ...base, groups: ["/provisioning"] }),
    201
  )
  expectStatus(
    "1",
    "create without groups",
    await post({
      ...base,
      username: names.user("create-b"),
      email: names.email("create-b"),
    }),
    403
  )
  expectStatus(
    "1",
    `create with groups ["/lab-member/master"]`,
    await post({
      ...base,
      username: names.user("create-c"),
      email: names.email("create-c"),
      groups: ["/lab-member/master"],
    }),
    403
  )
}

async function item2() {
  const labMember = await groupId("/lab-member")
  const parentName = `probe-${rand}`
  const parent = idOf(
    must(
      await admin("POST", `/${realm}/groups/${labMember}/children`, {
        name: parentName,
      }),
      [201],
      "parent group"
    )
  )
  trackedGroups.push(parent)
  const child = idOf(
    must(
      await admin("POST", `/${realm}/groups/${parent}/children`, {
        name: "child",
      }),
      [201],
      "child group"
    )
  )
  const user = await provisioned("inherit")
  const join = (g: string) =>
    provisioner("PUT", `/${realm}/users/${user}/groups/${g}`)
  record(
    "2",
    "child join before any permission on the parent",
    null,
    brief(await join(child))
  )
  await grant("inherit-parent", [parent], ["view", "manage-membership"])
  expectStatus(
    "2",
    "parent join once the parent has the permission (control)",
    await join(parent),
    204
  )
  const inherited = await join(child)
  record(
    "2",
    "child join with the permission on the parent only",
    inherited.status === 403,
    `${brief(inherited)} (want 403: manage-membership ${inherited.status === 403 ? "does not inherit" : "INHERITS"} to subgroups)`
  )
}

async function item3() {
  const user = await provisioned("scope")
  expectStatus(
    "3",
    "join /provisioning user to /lab-member/master",
    await provisioner(
      "PUT",
      `/${realm}/users/${user}/groups/${await groupId("/lab-member/master")}`
    ),
    204
  )
  record(
    "3",
    "setEnabled(true) via KeycloakAdmin",
    (await kc.setEnabled(user, true)) === "ok",
    ""
  )
  const on = (await provisioner("GET", `/${realm}/users/${user}`)).text
  record("3", "enabled is now true", /"enabled":true/.test(on), "")
  record(
    "3",
    "setEnabled(false) via KeycloakAdmin",
    (await kc.setEnabled(user, false)) === "ok",
    ""
  )
  await kc.setEnabled(user, true)
  const sent = await kc.executeActionsEmail(user, {
    lifespanSeconds: 3600,
    signal: new AbortController().signal,
  })
  record(
    "3",
    `execute-actions-email (client_id=portal, redirect_uri=${portalUrl})`,
    sent === "ok",
    sent
  )
  const mail = await waitForMail(names.email("scope"))
  record(
    "3",
    "mail arrived in mailpit",
    mail !== null,
    mail?.subject ?? "none within 20s"
  )
  const link = mail ? linkIn(mail) : undefined
  record(
    "3",
    "mail contains a link",
    link !== undefined,
    link ? describeLink(link) : "no link"
  )
}

async function item4() {
  const user = await provisioned("search")
  const app = `app-search-${rand}`
  const q = { q: `portal_application_id:${app}`, exact: "true" }
  const search = async (who: string, call: Caller, want: number) => {
    const r = await call("GET", `/${realm}/users`, undefined, q)
    let found = 0
    try {
      found = json<unknown[]>(r).length
    } catch {}
    record(
      "4",
      `q= on the admin-only attribute as ${who}`,
      r.status === want && (want !== 200 || found === 1),
      r.status === 200 ? `200 ${found} user(s)` : `${brief(r)} (want ${want})`
    )
  }
  // FGAP hides every user search from the provisioner: 403 is expected, and
  // the adapter asks the portal client instead.
  await search("portal-provisioner (403 expected)", provisioner, 403)
  await search("portal (view-users)", readerCall, 200)
  await search("probe-admin", admin, 200)
  let got: string
  try {
    got = String(await kc.findByApplicationId(app))
  } catch (error) {
    got = String(error)
  }
  record(
    "4",
    "KeycloakAdmin.findByApplicationId (provisioner credentials, reads through the portal client)",
    got === user,
    got === user ? "found the user" : got
  )
}

async function item5() {
  await provisioned("dup")
  const post = (o: Partial<NewKeycloakUser>) =>
    provisioner("POST", `/${realm}/users`, {
      ...newUser("dup"),
      ...o,
      enabled: false,
    })
  const sameName = await post({ email: names.email("dup-other") })
  record(
    "5",
    "same username, other email",
    sameName.status === 409,
    brief(sameName)
  )
  const sameEmail = await post({ username: names.user("dup-other") })
  record(
    "5",
    "same email, other username",
    sameEmail.status === 409,
    brief(sameEmail)
  )
  const both = await post({})
  record("5", "both the same", both.status === 409, brief(both))
}

async function item6() {
  const user = await provisioned("profile")
  const u = json<{ requiredActions?: string[] }>(
    must(await admin("GET", `/${realm}/users/${user}`), [200], "user")
  )
  const actions = u.requiredActions ?? []
  record(
    "6",
    "requiredActions of a created user",
    !actions.includes("UPDATE_PROFILE"),
    JSON.stringify(actions)
  )
  const profile = json<{
    attributes: { name: string; required?: object }[]
  }>(must(await admin("GET", `/${realm}/users/profile`), [200], "profile"))
  const ours = ["birthday", "nycu_email", "department", "portal_application_id"]
  const required = profile.attributes
    .filter(
      (a) =>
        a.required &&
        !["username", "email", "firstName", "lastName"].includes(a.name)
    )
    .map((a) => a.name)
  record(
    "6",
    "declared attributes marked required (besides the built-in four)",
    required.length === 0,
    `required: ${JSON.stringify(required)}; declared ours: ${JSON.stringify(profile.attributes.filter((a) => ours.includes(a.name)).map((a) => a.name))}`
  )
  const builtin = profile.attributes
    .filter((a) => ["email", "firstName", "lastName"].includes(a.name))
    .map((a) => `${a.name}:${a.required ? "required" : "optional"}`)
  record("6", "built-in attributes", null, builtin.join(" "))
}

async function item7() {
  // An existing /lab-member/teacher member who was never in /provisioning.
  const teacher = idOf(
    must(
      await admin("POST", `/${realm}/users`, {
        username: names.user("teacher"),
        email: names.email("teacher"),
        firstName: "Probe",
        lastName: "Teacher",
        enabled: true,
        groups: ["/lab-member/teacher"],
      }),
      [201],
      "teacher user"
    )
  )
  const teacherGroup = await groupId("/lab-member/teacher")
  expectStatus(
    "7",
    "existing member: view",
    await provisioner("GET", `/${realm}/users/${teacher}`),
    403
  )
  expectStatus(
    "7",
    "existing member: disable",
    await provisioner("PUT", `/${realm}/users/${teacher}`, { enabled: false }),
    403
  )
  expectStatus(
    "7",
    "existing member: remove from /lab-member/teacher",
    await provisioner(
      "DELETE",
      `/${realm}/users/${teacher}/groups/${teacherGroup}`
    ),
    403
  )
  expectStatus(
    "7",
    "existing member: execute-actions-email",
    await provisioner(
      "PUT",
      `/${realm}/users/${teacher}/execute-actions-email`,
      ["UPDATE_PASSWORD"]
    ),
    403
  )
  const still = json<{ enabled: boolean }>(
    must(await admin("GET", `/${realm}/users/${teacher}`), [200], "teacher")
  )
  record(
    "7",
    "existing member left untouched",
    still.enabled === true,
    `enabled=${still.enabled}`
  )

  const user = await provisioned("leave")
  const provisioning = await groupId("/provisioning")
  expectStatus(
    "7",
    "new account leaves /provisioning",
    await provisioner(
      "DELETE",
      `/${realm}/users/${user}/groups/${provisioning}`
    ),
    204
  )
  expectStatus(
    "7",
    "view after leaving /provisioning",
    await provisioner("GET", `/${realm}/users/${user}`),
    403
  )
  expectStatus(
    "7",
    "second leave (raw DELETE) after leaving",
    await provisioner(
      "DELETE",
      `/${realm}/users/${user}/groups/${provisioning}`
    ),
    403
  )
  const again = await kc.leaveGroup(user, "/provisioning")
  record("7", "leaveGroup after leaving maps to gone", again === "gone", again)
  try {
    const stranger = await kc.readUser(user)
    record(
      "7",
      "readUser after leaving",
      null,
      stranger === null ? "null" : "visible"
    )
  } catch (error) {
    record("7", "readUser after leaving (throws)", null, String(error))
  }

  // A user that no longer exists at all, for the 404 mappings.
  const gone = await provisioned("deleted")
  must(await admin("DELETE", `/${realm}/users/${gone}`), [204], "delete user")
  const mail = await groupId("/lab-member/master")
  const body = { enabled: true }
  record(
    "7",
    "deleted user: GET",
    null,
    brief(await provisioner("GET", `/${realm}/users/${gone}`))
  )
  record(
    "7",
    "deleted user: PUT enabled (setEnabled)",
    null,
    brief(await provisioner("PUT", `/${realm}/users/${gone}`, body))
  )
  record(
    "7",
    "deleted user: join a group (joinGroup)",
    null,
    brief(await provisioner("PUT", `/${realm}/users/${gone}/groups/${mail}`))
  )
  record(
    "7",
    "deleted user: execute-actions-email",
    null,
    brief(
      await provisioner(
        "PUT",
        `/${realm}/users/${gone}/execute-actions-email`,
        ["UPDATE_PASSWORD"]
      )
    )
  )
  record(
    "7",
    "deleted user: leave /provisioning",
    null,
    brief(
      await provisioner(
        "DELETE",
        `/${realm}/users/${gone}/groups/${provisioning}`
      )
    )
  )
}

async function item8Flow() {
  const email = names.email("reset")
  must(
    await admin("POST", `/${realm}/users`, {
      username: names.user("reset"),
      email,
      firstName: "Probe",
      lastName: "Reset",
      enabled: true,
      emailVerified: true,
    }),
    [201],
    "reset user"
  )
  const jar = new Map<string, string>()
  const visit = async (url: string, init: RequestInit = {}) => {
    let current = url
    for (let hop = 0; hop < 6; hop++) {
      const res = await fetch(current, {
        ...init,
        method: hop === 0 ? init.method : "GET",
        body: hop === 0 ? init.body : undefined,
        redirect: "manual",
        headers: {
          ...(init.headers as Record<string, string>),
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        },
        signal: sig(),
      })
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";")
        const eq = pair.indexOf("=")
        jar.set(pair.slice(0, eq), pair.slice(eq + 1))
      }
      const next = res.headers.get("location")
      if (res.status >= 300 && res.status < 400 && next)
        current = new URL(next, current).toString()
      else return { res, html: await res.text(), url: current }
    }
    throw new Error("too many redirects")
  }
  const page = await visit(
    `${issuer}/login-actions/reset-credentials?client_id=portal`
  )
  const action = /<form[^>]*\saction="([^"]+)"/
    .exec(page.html)?.[1]
    ?.replace(/&amp;/g, "&")
  const field = /<input[^>]*name="(username)"/.exec(page.html)?.[1]
  record(
    "8",
    "reset-credentials?client_id=portal opens the form",
    page.res.status === 200 && Boolean(action) && Boolean(field),
    `${page.res.status} form=${action ? "yes" : "no"} username-field=${field ? "yes" : "no"} title=${/<title>([^<]*)<\/title>/.exec(page.html)?.[1]?.trim() ?? "?"}`
  )
  if (!action) return
  const sent = await visit(new URL(action, page.url).toString(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: email }),
  })
  record(
    "8",
    "submitting the email",
    sent.res.status === 200,
    `${sent.res.status}`
  )
  const mail = await waitForMail(email)
  record(
    "8",
    "reset mail arrived in mailpit",
    mail !== null,
    mail?.subject ?? "none within 20s"
  )
  const link = mail ? linkIn(mail) : undefined
  record(
    "8",
    "reset mail contains a link",
    link !== undefined,
    link ? describeLink(link) : "no link"
  )
}

/**
 * The reset page only exists when the realm allows "forgot password", which
 * the test realm now sets (as production has it). An older realm without it
 * is switched on for this item and restored after; with it on, nothing is
 * toggled.
 */
async function item8() {
  const realmUrl = `/${realm}`
  const current = json<{ resetPasswordAllowed?: boolean }>(
    must(await admin("GET", realmUrl), [200], "realm")
  )
  const allowed = current.resetPasswordAllowed === true
  record(
    "8",
    "realm setting resetPasswordAllowed (keycloak-test-realm.ts sets it)",
    allowed,
    String(current.resetPasswordAllowed ?? false) +
      (allowed ? "" : " (an older realm: enabled temporarily for this item)")
  )
  if (!allowed)
    must(
      await admin("PUT", realmUrl, { resetPasswordAllowed: true }),
      [204],
      "enable reset"
    )
  try {
    await item8Flow()
  } finally {
    if (!allowed) await admin("PUT", realmUrl, { resetPasswordAllowed: false })
  }
}

// --- contract replay -----------------------------------------------------

type ReplayDeps = { mailGroup: () => Promise<void> }

async function replay() {
  const dir = reader
  const cases: [string, () => Promise<void>][] = []
  const eq = (got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want))
      throw new Error(
        `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`
      )
  }
  const deleteUser = async (id: string) => {
    must(await admin("DELETE", `/${realm}/users/${id}`), [204, 404], "delete")
  }
  let mailMade = false
  const deps: ReplayDeps = {
    // The contract's "/mail" group; the provisioner needs rights on it.
    mailGroup: async () => {
      if (mailMade) return
      mailMade = true
      const id = idOf(
        must(
          await admin("POST", `/${realm}/groups`, { name: "mail" }),
          [201],
          "mail group"
        )
      )
      trackedGroups.push(id)
      await grant("replay-mail", [id], ["view", "manage-membership"])
    },
  }
  const user = (tag: string, o: Partial<NewKeycloakUser> = {}) =>
    newUser(`r-${tag}`, o)
  const made = async (tag: string, o?: Partial<NewKeycloakUser>) => {
    const r = await kc.createUser(user(tag, o))
    if (!r.ok) throw new Error(`createUser failed: ${r.reason}`)
    return r.id
  }

  cases.push([
    "createUser creates a disabled user findable by application id",
    async () => {
      const id = await made("a")
      eq(await kc.findByApplicationId(`app-r-a-${rand}`), id)
      eq(await kc.findByApplicationId("other"), null)
      const u = await kc.readUser(id)
      eq(u?.enabled, false)
      eq(u?.username, names.user("r-a"))
      eq(u?.attributes.portal_application_id, [`app-r-a-${rand}`])
    },
  ])
  cases.push([
    "createUser reports username_taken before email_taken",
    async () => {
      await made("b")
      eq(await kc.createUser(user("b")), {
        ok: false,
        reason: "username_taken",
      })
      eq(await kc.createUser(user("b", { username: names.user("r-b2") })), {
        ok: false,
        reason: "email_taken",
      })
    },
  ])
  cases.push([
    "createUser rejects an unknown group as invalid",
    async () => {
      eq(await kc.createUser(user("c", { groups: ["/nope"] })), {
        ok: false,
        reason: "invalid",
      })
    },
  ])
  cases.push([
    "joinGroup reports group_missing and user_gone",
    async () => {
      const id = await made("d")
      await deps.mailGroup()
      eq(await kc.joinGroup(id, "/mail"), "ok")
      eq(await kc.joinGroup(id, "/nope"), "group_missing")
      await deleteUser(id)
      eq(await kc.joinGroup(id, "/mail"), "user_gone")
    },
  ])
  cases.push([
    "leaveGroup is gone for a deleted user and ok otherwise",
    async () => {
      const id = await made("e")
      eq(await kc.leaveGroup(id, "/provisioning"), "ok")
      await deleteUser(id)
      eq(await kc.leaveGroup(id, "/provisioning"), "gone")
    },
  ])
  cases.push([
    "setEnabled and executeActionsEmail report user_gone",
    async () => {
      const id = await made("f")
      eq(await kc.setEnabled(id, true), "ok")
      eq((await kc.readUser(id))?.enabled, true)
      const opts = { lifespanSeconds: 60, signal: new AbortController().signal }
      eq(await kc.executeActionsEmail(id, opts), "ok")
      await deleteUser(id)
      eq(await kc.setEnabled(id, true), "user_gone")
      eq(await kc.executeActionsEmail(id, opts), "user_gone")
      eq(await kc.readUser(id), null)
    },
  ])
  cases.push([
    "a user outside the boundary is forbidden for writes but still readable",
    async () => {
      const id = await made("h")
      await deps.mailGroup()
      must(
        await admin(
          "DELETE",
          `/${realm}/users/${id}/groups/${await groupId("/provisioning")}`
        ),
        [204],
        "move outside the boundary"
      )
      const opts = { lifespanSeconds: 60, signal: new AbortController().signal }
      eq(await kc.setEnabled(id, true), "forbidden")
      eq(await kc.joinGroup(id, "/mail"), "forbidden")
      eq(await kc.executeActionsEmail(id, opts), "forbidden")
      eq(await kc.leaveGroup(id, "/provisioning"), "gone")
      eq((await kc.readUser(id))?.username, names.user("r-h"))
      eq(await kc.findByApplicationId(`app-r-h-${rand}`), id)
    },
  ])
  cases.push([
    "directory reads what was created (portal client as the directory)",
    async () => {
      await made("g")
      const email = names.email("r-g")
      eq(await dir.emailExists(Email.parse(email.toUpperCase())), true)
      eq(
        await dir.emailExists(Email.parse(`nobody-${rand}@example.com`)),
        false
      )
      const taken = await dir.usernamesTaken([
        Username.restore(names.user("r-g")),
        Username.restore(`probe-other-${rand}`),
      ])
      eq([...taken], [names.user("r-g")])
      eq(await dir.groupExists("/provisioning"), true)
      eq(await dir.groupExists("/nope"), false)
    },
  ])

  for (const [name, fn] of cases) {
    try {
      await fn()
      record("replay", name, true, "ok")
    } catch (error) {
      record("replay", name, false, String(error).slice(0, 300))
    }
  }
}

// --- cleanup -------------------------------------------------------------

async function cleanup() {
  const notes: string[] = []
  const attempt = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (error) {
      notes.push(`${what}: ${String(error).slice(0, 120)}`)
    }
  }
  await attempt("users", async () => {
    const found = json<{ id: string; username: string }[]>(
      must(
        await admin("GET", `/${realm}/users`, undefined, {
          username: "probe-",
          max: "500",
        }),
        [200],
        "list users"
      )
    ).filter((u) => u.username.startsWith("probe-"))
    for (const u of found)
      await attempt(`user ${u.username}`, async () => {
        must(
          await admin("DELETE", `/${realm}/users/${u.id}`),
          [204, 404],
          "delete user"
        )
      })
  })
  await attempt("permissions", async () => {
    const base = await authz()
    const found = json<{ id: string; name: string }[]>(
      must(
        await admin("GET", `${base}/policy`, undefined, {
          name: "probe-",
          permission: "true",
          max: "200",
        }),
        [200],
        "list permissions"
      )
    ).filter((p) => p.name.startsWith("probe-"))
    for (const p of found)
      await attempt(`permission ${p.name}`, async () => {
        must(
          await admin("DELETE", `${base}/policy/${p.id}`),
          [200, 204, 404],
          "delete permission"
        )
      })
  })
  for (const id of trackedGroups)
    await attempt(`group ${id}`, async () => {
      must(
        await admin("DELETE", `/${realm}/groups/${id}`),
        [204, 404],
        "delete group"
      )
    })
  return notes
}

// --- main ----------------------------------------------------------------

const escape = (s: string) => s.replace(/\|/g, "\\|")
try {
  await section("1", item1)
  await section("2", item2)
  await section("3", item3)
  await section("4", item4)
  await section("5", item5)
  await section("6", item6)
  await section("7", item7)
  await section("8", item8)
  await section("replay", replay)
} finally {
  const notes = await cleanup()
  console.log(`\nRealm ${issuer} (probe run ${rand})\n`)
  console.log("| Item | Check | Result | Actual response |")
  console.log("| --- | --- | --- | --- |")
  for (const r of rows)
    console.log(
      `| ${r.item} | ${escape(r.check)} | ${r.pass === null ? "INFO" : r.pass ? "PASS" : "FAIL"} | ${escape(r.actual)} |`
    )
  const tally = new Map<string, { pass: number; fail: number }>()
  for (const r of rows) {
    if (r.pass === null) continue
    const t = tally.get(r.item) ?? { pass: 0, fail: 0 }
    t[r.pass ? "pass" : "fail"]++
    tally.set(r.item, t)
  }
  console.log(
    "\nPer item: " +
      [...tally]
        .map(([k, t]) => `${k}: ${t.pass} pass / ${t.fail} fail`)
        .join("; ")
  )
  console.log(
    notes.length
      ? `\nCleanup problems:\n${notes.map((n) => `- ${n}`).join("\n")}`
      : "\nCleanup: probe-* users, temporary groups and permissions removed."
  )
  if (rows.some((r) => r.pass === false)) process.exitCode = 1
}
