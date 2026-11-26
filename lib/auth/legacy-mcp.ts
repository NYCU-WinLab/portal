import { requireMcpAuth } from "@better-auth/mcp"

import { adminAppsOf } from "@/lib/actions/authz"
import { auth, mcpResource } from "@/lib/auth"
import { isLabMember } from "@/lib/auth/member"
import { mcpHandler } from "@/lib/mcp/server"
import { parseToolsets } from "@/lib/mcp/toolsets"

// The signing keys come from this same server over loopback, not through the
// public gateway; Better Auth caches them for 5 minutes either way.
const jwksUrl = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/auth/jwks`

// Every other /mcp error is JSON-RPC, so a refusal is too.
const refuse = (status: number, message: string) =>
  Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message }, id: null },
    { status }
  )

// Tokens the portal issued itself, before Keycloak took over. Members who
// connected then keep working until their client signs in again, which now
// goes to Keycloak. Remove once no refresh token from the portal's own MCP
// sign-in is left (the developer apps' tokens never reach /mcp).
//
// Better Auth checks the bearer token (JWKS signature, issuer, audience,
// expiry) and answers 401 with the RFC 9728 challenge. The token's sub is
// the member every tool acts as.
export const legacyMcp = requireMcpAuth(
  auth,
  async (request, claims) => {
    // A client_credentials token names the client, not a member.
    const clientId = String(claims.azp ?? claims.client_id ?? "")
    if (!claims.sub || claims.sub === clientId)
      return refuse(403, "not a member token")
    // A valid token is not enough: the member must still be in the lab.
    try {
      if (!(await isLabMember(claims.sub)))
        return refuse(403, "no longer a lab member")
    } catch {
      return refuse(503, "cannot reach Keycloak to check membership")
    }
    let adminApps: string[]
    try {
      adminApps = [...(await adminAppsOf({ userId: claims.sub, via: "mcp" }))]
    } catch {
      return refuse(503, "cannot read the member's admin roles")
    }
    return mcpHandler.fetch(request, {
      authInfo: {
        token: "",
        clientId,
        scopes: String(claims.scope ?? "")
          .split(" ")
          .filter(Boolean),
        expiresAt: claims.exp,
        extra: {
          userId: claims.sub,
          adminApps,
          toolsets: [
            ...parseToolsets(
              new URL(request.url).searchParams.get("toolsets") ??
                request.headers.get("x-portal-toolsets")
            ),
          ],
        },
      },
    })
  },
  { resource: mcpResource, jwksUrl }
)
