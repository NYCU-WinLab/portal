import OAuth2Server from "@node-oauth/oauth2-server"
import { createOAuthServer, matchesSecret, hashSecret } from "./oauth"
import type { OAuthStore } from "./types"

export function json(body: unknown, status = 200, origin?: string) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      ...(origin
        ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
        : {}),
    },
  })
}
export function oauthError(error: unknown, origin?: string) {
  if (error instanceof OAuth2Server.OAuthError && error.code < 500)
    return json(
      { error: error.name, error_description: error.message },
      error.code,
      origin
    )
  return json(
    {
      error: "temporarily_unavailable",
      error_description: "The identity service is temporarily unavailable.",
    },
    503,
    origin
  )
}
export async function formParameters(request: Request) {
  if (
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    throw new OAuth2Server.InvalidRequestError(
      "Use application/x-www-form-urlencoded"
    )
  const text = await request.text()
  if (text.length > 8192)
    throw new OAuth2Server.InvalidRequestError("Request too large")
  const params = new URLSearchParams(text)
  const out: Record<string, string> = {}
  for (const [key, value] of params) {
    if (Object.hasOwn(out, key))
      throw new OAuth2Server.InvalidRequestError("Duplicate parameter")
    out[key] = value
  }
  return out
}
export function clientCredentials(
  request: Request,
  body: Record<string, string>
) {
  const authorization = request.headers.get("authorization")
  if (!authorization)
    return { id: body.client_id ?? "", secret: body.client_secret }
  if (
    !authorization.startsWith("Basic ") ||
    body.client_secret ||
    body.client_id
  )
    throw new OAuth2Server.InvalidRequestError(
      "Use one client authentication method"
    )
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString(
      "utf8"
    )
    const colon = decoded.indexOf(":")
    if (colon < 1) throw new Error("Invalid Basic credentials")
    return {
      id: decodeURIComponent(decoded.slice(0, colon)),
      secret: decodeURIComponent(decoded.slice(colon + 1)),
    }
  } catch {
    throw new OAuth2Server.InvalidClientError("Invalid client")
  }
}
export async function checkedClient(
  store: OAuthStore,
  request: Request,
  body: Record<string, string>,
  authenticate: boolean
) {
  const credentials = clientCredentials(request, body)
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(credentials.id))
    throw new OAuth2Server.InvalidClientError("Invalid client")
  const app = await store.app(credentials.id)
  if (!app?.enabled) throw new OAuth2Server.InvalidClientError("Invalid client")
  if (
    authenticate &&
    app.client_type === "confidential" &&
    (!credentials.secret || !matchesSecret(credentials.secret, app.secret_hash))
  )
    throw new OAuth2Server.InvalidClientError("Invalid client")
  const origin = request.headers.get("origin")
  if (
    origin &&
    !app.redirect_uris.some((uri) => new URL(uri).origin === origin)
  )
    throw new OAuth2Server.InvalidRequestError("Origin is not registered")
  return { app, origin: origin ?? undefined }
}
export async function tokenResponse(request: Request, store: OAuthStore) {
  let origin: string | undefined
  try {
    const body = await formParameters(request)
    const checked = await checkedClient(store, request, body, true)
    origin = checked.origin
    if (
      !["authorization_code", "refresh_token"].includes(body.grant_type ?? "")
    )
      throw new OAuth2Server.UnsupportedGrantTypeError("Unsupported grant type")
    const response = new OAuth2Server.Response()
    await createOAuthServer(store, "token").token(
      new OAuth2Server.Request({
        method: "POST",
        headers: {
          ...Object.fromEntries(request.headers),
          "transfer-encoding": "chunked",
        },
        body,
        query: {},
      }),
      response
    )
    return json(response.body as unknown, response.status ?? 200, origin)
  } catch (error) {
    return oauthError(error, origin)
  }
}
export function preflight(request: Request) {
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": request.headers.get("origin") ?? "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      Vary: "Origin",
    },
  })
}
export async function revokeResponse(
  request: Request,
  store: OAuthStore,
  revokeGrant: (id: string) => Promise<void>
) {
  let origin: string | undefined
  try {
    const body = await formParameters(request)
    const checked = await checkedClient(store, request, body, true)
    origin = checked.origin
    if (!body.token)
      throw new OAuth2Server.InvalidRequestError("Token required")
    const hash = hashSecret(body.token)
    const token =
      (await store.token(hash, "access")) ??
      (await store.token(hash, "refresh"))
    if (token) {
      const grant = await store.grant(token.grant_id)
      if (grant?.app_id === checked.app.id) await revokeGrant(grant.id)
    }
    return new Response(null, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        ...(origin
          ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
          : {}),
      },
    })
  } catch (error) {
    return oauthError(error, origin)
  }
}
