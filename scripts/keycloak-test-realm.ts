/**
 * Builds a disposable Keycloak realm that mirrors what the provisioning worker
 * needs in `winlab`: the `/provisioning` and `/lab-member/*` groups, the
 * declared user-profile attributes, the read-only `portal` client and the
 * group-scoped `portal-provisioner` client (fine-grained admin permissions v2,
 * no realm-management roles), plus a `probe-admin` client that
 * scripts/keycloak-probe.ts uses to set up and clean up.
 *
 * Run against a throwaway server only (a local `quay.io/keycloak/keycloak`
 * container): the realm is deleted and recreated on every run, and the realm
 * name must end in `-test`. Credentials go to the file given with --out
 * (mode 600), never to stdout.
 *
 *   KC_BASE=http://127.0.0.1:18080 KC_ADMIN_PASSWORD=… \
 *     bun scripts/keycloak-test-realm.ts --out ~/work/tmp/…/keycloak-test.env
 */
import { chmodSync, writeFileSync } from "node:fs"

const base = (process.env.KC_BASE ?? "").replace(/\/$/, "")
const realm = process.env.KC_REALM ?? "winlab-test"
const adminUser = process.env.KC_ADMIN_USER ?? "admin"
const adminPassword = process.env.KC_ADMIN_PASSWORD ?? ""
const portalUrl = process.env.PORTAL_URL ?? "http://localhost:3000"
const smtpHost = process.env.KC_SMTP_HOST ?? "portal-kc-probe-mail"
const smtpPort = process.env.KC_SMTP_PORT ?? "1025"
const outIndex = process.argv.indexOf("--out")
const out = outIndex > 0 ? process.argv[outIndex + 1] : undefined

if (!base || !adminPassword || !out)
  throw new Error("KC_BASE, KC_ADMIN_PASSWORD and --out <file> are required")
if (!realm.endsWith("-test"))
  throw new Error(`refusing realm "${realm}": the name must end in -test`)
if (/winlab\.tw/.test(new URL(base).hostname))
  throw new Error(`refusing ${base}: this script is for a throwaway server`)

/** Lab statuses and the cohorts the probe uses (lib/applications/domain). */
const STATUSES = ["teacher", "assistant", "doctoral", "master", "undergrad"]
const COHORTS = ["116", "117"]

let token = ""
async function login() {
  const res = await fetch(
    `${base}/realms/master/protocol/openid-connect/token`,
    {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: adminUser,
        password: adminPassword,
      }),
    }
  )
  if (!res.ok) throw new Error(`master login failed: ${res.status}`)
  token = ((await res.json()) as { access_token: string }).access_token
}

async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  okStatuses: number[] = []
): Promise<{ status: number; data: T; location: string | null }> {
  const res = await fetch(`${base}/admin/realms${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok && !okStatuses.includes(res.status))
    throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`)
  return {
    status: res.status,
    data: (text ? JSON.parse(text) : null) as T,
    location: res.headers.get("location"),
  }
}

const r = (path = "") => `/${realm}${path}`

async function clientUuid(clientId: string): Promise<string> {
  const { data } = await api<{ id: string }[]>(
    "GET",
    r(`/clients?clientId=${encodeURIComponent(clientId)}`)
  )
  if (!data[0]) throw new Error(`client ${clientId} not found`)
  return data[0].id
}

async function groupId(path: string): Promise<string> {
  const { data } = await api<{ id: string }>(
    "GET",
    r(`/group-by-path/${path.replace(/^\//, "")}`)
  )
  return data.id
}

async function main() {
  await login()

  // 1. Fresh realm every run.
  await api("DELETE", r(), undefined, [404])
  await api("POST", "", {
    realm,
    enabled: true,
    adminPermissionsEnabled: true,
    // Production has "forgot password" on; the reset-mail checks rely on it.
    resetPasswordAllowed: true,
    registrationAllowed: false,
    smtpServer: {
      host: smtpHost,
      port: smtpPort,
      from: "noreply@winlab-test.invalid",
      fromDisplayName: "WinLab test",
    },
    groups: [
      // Submit checks usernames against /system members, as in production.
      { name: "system" },
      { name: "provisioning" },
      {
        name: "lab-member",
        subGroups: [...STATUSES, ...COHORTS].map((name) => ({ name })),
      },
    ],
    clients: [
      {
        // Same role as winlab's portal client: OIDC sign-in plus read-only lookups.
        clientId: "portal",
        protocol: "openid-connect",
        publicClient: false,
        clientAuthenticatorType: "client-secret",
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: true,
        redirectUris: [`${portalUrl}/*`],
        webOrigins: [portalUrl],
      },
      {
        // Group-scoped writer: client credentials only, no browser flows.
        clientId: "portal-provisioner",
        protocol: "openid-connect",
        publicClient: false,
        clientAuthenticatorType: "client-secret",
        standardFlowEnabled: false,
        implicitFlowEnabled: false,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: true,
        fullScopeAllowed: false,
      },
      {
        // The probe's own setup and cleanup; holds realm-admin, test realm only.
        clientId: "probe-admin",
        protocol: "openid-connect",
        publicClient: false,
        clientAuthenticatorType: "client-secret",
        standardFlowEnabled: false,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: true,
      },
    ],
  })

  // 2. Declarative user profile: the attributes the worker writes.
  const { data: profile } = await api<{
    attributes: { name: string }[]
    [k: string]: unknown
  }>("GET", r("/users/profile"))
  const adminOnly = { view: ["admin"], edit: ["admin"] }
  const selfVisible = { view: ["admin", "user"], edit: ["admin"] }
  const wanted = [
    { name: "birthday", displayName: "生日", permissions: selfVisible },
    { name: "nycu_email", displayName: "NYCU email", permissions: selfVisible },
    { name: "department", displayName: "系所", permissions: selfVisible },
    {
      name: "portal_application_id",
      displayName: "portal application id",
      permissions: adminOnly,
      validations: { length: { max: 64 } },
    },
  ]
  profile.attributes = [
    ...profile.attributes.filter((a) => !wanted.some((w) => w.name === a.name)),
    ...wanted,
  ]
  await api("PUT", r("/users/profile"), profile)

  // 3. Service-account roles.
  const realmManagement = await clientUuid("realm-management")
  const roleOf = async (name: string) =>
    (
      await api<{ id: string; name: string }>(
        "GET",
        r(`/clients/${realmManagement}/roles/${name}`)
      )
    ).data
  const serviceUser = async (clientId: string) =>
    (
      await api<{ id: string }>(
        "GET",
        r(`/clients/${await clientUuid(clientId)}/service-account-user`)
      )
    ).data.id
  const grant = async (clientId: string, roles: string[]) =>
    api(
      "POST",
      r(
        `/users/${await serviceUser(clientId)}/role-mappings/clients/${realmManagement}`
      ),
      await Promise.all(roles.map(roleOf))
    )
  await grant("portal", ["view-users"])
  await grant("probe-admin", ["realm-admin"])
  // portal-provisioner gets no realm-management role: those bypass FGAP.

  // 4. Keycloak 26.8.2+ checks the Admin API audience: tokens need kc-admin-api.
  const { data: scopes } = await api<{ id: string; name: string }[]>(
    "GET",
    r("/client-scopes")
  )
  const adminApiScope = scopes.find((s) => s.name === "kc-admin-api")
  if (adminApiScope)
    for (const clientId of ["portal", "portal-provisioner", "probe-admin"])
      await api(
        "PUT",
        r(
          `/clients/${await clientUuid(clientId)}/default-client-scopes/${adminApiScope.id}`
        )
      )

  // 5. Fine-grained admin permissions v2 for portal-provisioner.
  const authz = `/clients/${await clientUuid("admin-permissions")}/authz/resource-server`
  const provisionerUser = await serviceUser("portal-provisioner")
  await api("POST", r(`${authz}/policy/user`), {
    name: "portal-provisioner",
    logic: "POSITIVE",
    users: [provisionerUser],
  })
  const permission = (name: string, groups: string[], scopes: string[]) =>
    api("POST", r(`${authz}/permission/scope`), {
      name,
      resourceType: "Groups",
      resources: groups,
      scopes,
      policies: ["portal-provisioner"],
      decisionStrategy: "UNANIMOUS",
    })
  // Create users straight into /provisioning and manage them while they are there.
  await permission(
    "portal-provisioner: /provisioning",
    [await groupId("/provisioning")],
    [
      "view",
      "view-members",
      "manage-members",
      "manage-membership",
      "manage-membership-of-members",
    ]
  )
  // Add them to each /lab-member subgroup; manage-membership does not cascade.
  await permission(
    "portal-provisioner: /lab-member/*",
    await Promise.all(
      [...STATUSES, ...COHORTS].map((g) => groupId(`/lab-member/${g}`))
    ),
    ["view", "manage-membership"]
  )

  // 6. Credentials to a private file.
  const secret = async (clientId: string) =>
    (
      await api<{ value: string }>(
        "GET",
        r(`/clients/${await clientUuid(clientId)}/client-secret`)
      )
    ).data.value
  const lines = [
    `# Disposable test realm on ${base}; generated ${new Date().toISOString()}`,
    `KEYCLOAK_PROBE_ISSUER=${base}/realms/${realm}`,
    `KEYCLOAK_PROBE_PROVISIONER_ID=portal-provisioner`,
    `KEYCLOAK_PROBE_PROVISIONER_SECRET=${await secret("portal-provisioner")}`,
    `KEYCLOAK_PROBE_READER_ID=portal`,
    `KEYCLOAK_PROBE_READER_SECRET=${await secret("portal")}`,
    `KEYCLOAK_PROBE_ADMIN_ID=probe-admin`,
    `KEYCLOAK_PROBE_ADMIN_SECRET=${await secret("probe-admin")}`,
    `KEYCLOAK_PROBE_PORTAL_URL=${portalUrl}`,
    "",
  ]
  writeFileSync(out!, lines.join("\n"), { mode: 0o600 })
  chmodSync(out!, 0o600)
  console.log(
    `realm ${realm} ready on ${base}; kc-admin-api scope ${adminApiScope ? "assigned" : "not present (before 26.8.2)"}; credentials in ${out}`
  )
}

await main()
