import { requireMcpAuth } from "@better-auth/mcp"

import { auth, mcpResource } from "@/lib/auth"
import { mcpHandler } from "@/lib/mcp/server"

// Better Auth checks the bearer token (JWKS signature, issuer, audience,
// expiry) and answers 401 with the RFC 9728 challenge. The token's sub is
// the member every tool acts as.
export const POST = requireMcpAuth(
  auth,
  (request, claims) => {
    // A client_credentials token names the client, not a member.
    const clientId = String(claims.azp ?? claims.client_id ?? "")
    if (!claims.sub || claims.sub === clientId) {
      return Response.json(
        { error: "invalid_token", error_description: "not a member token" },
        { status: 403 }
      )
    }
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
  { resource: mcpResource }
)
