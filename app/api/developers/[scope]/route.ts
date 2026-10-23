import OAuth2Server from "@node-oauth/oauth2-server"

import { createOAuthStore, memberData } from "@/lib/actions/developers"
import { json, oauthError, preflight } from "@/lib/developers/http"
import { createOAuthServer } from "@/lib/developers/oauth"
import { scopeSchema } from "@/lib/developers/policy"

// A member's data for an application holding a token with this scope.
export async function GET(
  request: Request,
  context: { params: Promise<{ scope: string }> }
) {
  let origin: string | undefined
  try {
    const scope = scopeSchema.safeParse((await context.params).scope)
    if (!scope.success) return json({ error: "invalid_scope" }, 404)
    if (!request.headers.get("authorization")?.startsWith("Bearer "))
      return json({ error: "invalid_token" }, 401)
    const store = createOAuthStore()
    const token = await createOAuthServer(store, "token").authenticate(
      new OAuth2Server.Request({
        method: "GET",
        headers: Object.fromEntries(request.headers),
        query: {},
      }),
      new OAuth2Server.Response(),
      { scope: [scope.data] }
    )
    const app = await store.app(token.client.id)
    const requestOrigin = request.headers.get("origin")
    if (requestOrigin) {
      if (
        !app?.redirect_uris.some((uri) => new URL(uri).origin === requestOrigin)
      )
        return json({ error: "invalid_request" }, 403)
      origin = requestOrigin
    }
    return json(
      await memberData(String(token.user.id), scope.data),
      200,
      origin
    )
  } catch (error) {
    return oauthError(error, origin)
  }
}
export const OPTIONS = preflight
