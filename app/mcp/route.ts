import { requireMcpAuth } from "@better-auth/mcp"

import { auth, mcpResource } from "@/lib/auth"
import { mcpHandler } from "@/lib/mcp/server"

// The signing keys come from this same server over loopback, not through the
// public gateway; Better Auth caches them for 5 minutes either way.
const jwksUrl = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/auth/jwks`

// Every other /mcp error is JSON-RPC, so a refusal is too.
const forbidden = (message: string) =>
  Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message }, id: null },
    { status: 403 }
  )

// Better Auth checks the bearer token (JWKS signature, issuer, audience,
// expiry) and answers 401 with the RFC 9728 challenge. The token's sub is
// the member every tool acts as.
export const POST = requireMcpAuth(
  auth,
  (request, claims) => {
    // A client_credentials token names the client, not a member.
    const clientId = String(claims.azp ?? claims.client_id ?? "")
    if (!claims.sub || claims.sub === clientId)
      return forbidden("not a member token")
    return mcpHandler.fetch(request, {
      authInfo: {
        token: "",
        clientId,
        scopes: String(claims.scope ?? "")
          .split(" ")
          .filter(Boolean),
        expiresAt: claims.exp,
        extra: { userId: claims.sub },
      },
    })
  },
  { resource: mcpResource, jwksUrl }
)
