import OAuth2Server from "@node-oauth/oauth2-server"

import {
  createOAuthStore,
  keycloakMemberData,
  memberData,
} from "@/lib/actions/developers"
import { Refusal } from "@/lib/actions/define"
import { TokenRefused } from "@/lib/auth/keycloak-token"
import { json, oauthError, preflight } from "@/lib/developers/http"
import { createOAuthServer } from "@/lib/developers/oauth"
import { scopeSchema, type Scope } from "@/lib/developers/policy"

// A member's data for an application holding a token with this scope: a
// Keycloak access token (a JWT) for applications that are Keycloak clients,
// or a token from portal's own OAuth service for those not moved yet.
export async function GET(
  request: Request,
  context: { params: Promise<{ scope: string }> }
) {
  const scope = scopeSchema.safeParse((await context.params).scope)
  if (!scope.success) return json({ error: "invalid_scope" }, 404)
  const authorization = request.headers.get("authorization") ?? ""
  if (!authorization.startsWith("Bearer "))
    return json({ error: "invalid_token" }, 401)
  const token = authorization.slice(7).trim()
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)
    ? fromKeycloak(request, token, scope.data)
    : fromPortal(request, scope.data)
}
export const OPTIONS = preflight

/** CORS only for an origin among the application's redirect URIs. */
function allowedOrigin(request: Request, redirectUris: string[]) {
  const origin = request.headers.get("origin")
  if (!origin) return { ok: true as const }
  return redirectUris.some((uri) => new URL(uri).origin === origin)
    ? { ok: true as const, origin }
    : { ok: false as const }
}

async function fromKeycloak(request: Request, token: string, scope: Scope) {
  try {
    const { data, redirectUris } = await keycloakMemberData(token, scope)
    const cors = allowedOrigin(request, redirectUris)
    if (!cors.ok) return json({ error: "invalid_request" }, 403)
    return json(data, 200, cors.origin)
  } catch (error) {
    if (error instanceof TokenRefused)
      return error.status === 503
        ? json({ error: "temporarily_unavailable" }, 503)
        : json(
            {
              error:
                error.status === 403 ? "insufficient_scope" : "invalid_token",
            },
            error.status
          )
    if (error instanceof Refusal) return json({ error: "access_denied" }, 403)
    return json({ error: "temporarily_unavailable" }, 503)
  }
}

async function fromPortal(request: Request, scope: Scope) {
  let origin: string | undefined
  try {
    const store = createOAuthStore()
    const token = await createOAuthServer(store, "token").authenticate(
      new OAuth2Server.Request({
        method: "GET",
        headers: Object.fromEntries(request.headers),
        query: {},
      }),
      new OAuth2Server.Response(),
      { scope: [scope] }
    )
    const app = await store.app(token.client.id)
    const cors = allowedOrigin(request, app?.redirect_uris ?? [])
    if (!cors.ok) return json({ error: "invalid_request" }, 403)
    origin = cors.origin
    return json(await memberData(String(token.user.id), scope), 200, origin)
  } catch (error) {
    return oauthError(error, origin)
  }
}
