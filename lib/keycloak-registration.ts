// Registers /developers applications as clients in Keycloak (realm winlab),
// which then signs members in and issues the tokens. Portal's registrar
// service account holds only realm-management create-client: it registers
// through the client registration service, and each client is managed only
// with the registration access token Keycloak returned for it. The realm's
// authenticated registration policies keep these clients safe whatever
// portal sends: consent required, no full scope, only the portal scopes
// (pki/keycloak/developers-realm.sh). This module never touches the database.

import { traced } from "@/lib/otel"

const issuer = () => process.env.KEYCLOAK_ISSUER!
const endpoint = () => `${issuer()}/clients-registrations/default`
const timeout = () => AbortSignal.timeout(10_000)

/** Whether this portal registers new applications in Keycloak. */
export const registrarConfigured = () =>
  Boolean(
    process.env.KEYCLOAK_REGISTRAR_CLIENT_ID &&
    process.env.KEYCLOAK_REGISTRAR_SECRET &&
    process.env.KEYCLOAK_ISSUER &&
    // The registration token is sealed with it: without it a new client
    // would be left in Keycloak with no way to manage it.
    process.env.DEVELOPERS_SECRET
  )

/** The audience of portal's developer API in these clients' access tokens. */
export const developerApiAudience = () =>
  `${process.env.BETTER_AUTH_URL}/api/developers`

/** Keycloak's consent-only scope for each restricted portal scope. */
export const RESTRICTED_SCOPES = {
  name: "portal-name",
  groups: "portal-groups",
} as const

export class RegistrationLost extends Error {}

export type ClientSpec = {
  clientId: string
  name: string
  description: string
  public: boolean
  redirectUris: string[]
  /** Restricted portal scopes a portal admin approved for this application. */
  restricted: ("name" | "groups")[]
  /** Off: no member can sign in and no token is refreshed. */
  on: boolean
}

async function registrarToken() {
  const response = await fetch(`${issuer()}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.KEYCLOAK_REGISTRAR_CLIENT_ID!,
      client_secret: process.env.KEYCLOAK_REGISTRAR_SECRET!,
    }),
    cache: "no-store",
    signal: timeout(),
  })
  if (!response.ok)
    throw new Error(`Keycloak registrar token ${response.status}`)
  return ((await response.json()) as { access_token: string }).access_token
}

const origins = (uris: string[]) => [
  ...new Set(uris.map((u) => new URL(u).origin)),
]

/** The whole client as Keycloak should hold it: every field, every time. */
function representation(
  spec: ClientSpec,
  extra: { secret?: string; notBefore?: number }
) {
  return {
    clientId: spec.clientId,
    name: spec.name.slice(0, 100),
    description: spec.description.slice(0, 255),
    protocol: "openid-connect",
    // Disabling a client cannot be undone with its registration token, so
    // "off" closes the sign-in flow instead and notBefore ends its tokens.
    enabled: true,
    publicClient: spec.public,
    ...(extra.secret ? { secret: extra.secret } : {}),
    clientAuthenticatorType: "client-secret",
    standardFlowEnabled: spec.on,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    bearerOnly: false,
    consentRequired: true,
    fullScopeAllowed: false,
    frontchannelLogout: false,
    redirectUris: spec.redirectUris,
    webOrigins: origins(spec.redirectUris),
    // Named in full: the realm's default scopes include chinese_name, and
    // Keycloak's profile scope carries the name. Only an approved name scope
    // may reveal it (through portal's API); portal-profile maps the username.
    defaultClientScopes: [
      "basic",
      "email",
      "portal-profile",
      "portal-developers",
    ],
    optionalClientScopes: spec.restricted.map((s) => RESTRICTED_SCOPES[s]),
    attributes: {
      "pkce.code.challenge.method": "S256",
      "oauth2.device.authorization.grant.enabled": "false",
      "oidc.ciba.grant.enabled": "false",
      "standard.token.exchange.enabled": "false",
      "post.logout.redirect.uris": "",
    },
    ...(extra.notBefore ? { notBefore: extra.notBefore } : {}),
  }
}

async function call(
  method: string,
  url: string,
  token: string,
  body?: unknown
) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: timeout(),
  })
  if (response.status === 401 && method !== "POST")
    throw new RegistrationLost(
      `Keycloak refused the registration token of this client`
    )
  if (!response.ok)
    throw new Error(
      `Keycloak client registration ${method} ${response.status}: ${(await response.text()).slice(0, 200)}`
    )
  return response.status === 204
    ? null
    : ((await response.json()) as { registrationAccessToken?: string })
}

/** Creates the client; returns its registration access token. */
export function registerClient(spec: ClientSpec, secret?: string) {
  return traced("keycloak.register_client", {}, async () => {
    const created = await call(
      "POST",
      endpoint(),
      await registrarToken(),
      representation(spec, { secret })
    )
    if (!created?.registrationAccessToken)
      throw new Error("Keycloak returned no registration token")
    return created.registrationAccessToken
  })
}

/**
 * Writes the client again from spec. A new secret replaces the old one;
 * notBefore (epoch seconds) ends every token issued before it. Keycloak
 * checks it only when it sees a token: portal's API compares iat itself.
 * Keycloak rotates the registration
 * token on every update: the caller must store the one returned, in the
 * same transaction that holds the application row.
 */
export function updateClient(
  spec: ClientSpec,
  rat: string,
  change: { secret?: string; notBefore?: number } = {}
) {
  return traced("keycloak.update_client", {}, async () => {
    const updated = await call(
      "PUT",
      `${endpoint()}/${encodeURIComponent(spec.clientId)}`,
      rat,
      representation(spec, {
        secret: change.secret,
        notBefore: change.notBefore,
      })
    )
    if (!updated?.registrationAccessToken)
      throw new Error("Keycloak returned no registration token")
    return updated.registrationAccessToken
  })
}

/** Deletes the client; one already gone counts as deleted. */
export function deleteClient(clientId: string, rat: string) {
  return traced("keycloak.delete_client", {}, async () => {
    const response = await fetch(
      `${endpoint()}/${encodeURIComponent(clientId)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${rat}` },
        cache: "no-store",
        signal: timeout(),
      }
    )
    if (response.status === 401)
      throw new RegistrationLost(
        "Keycloak refused the registration token of this client"
      )
    if (!response.ok && response.status !== 404)
      throw new Error(`Keycloak client registration DELETE ${response.status}`)
  })
}
