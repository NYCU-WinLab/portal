import { requireMcpAuth } from "@better-auth/mcp"

import { auth, mcpResource } from "@/lib/auth"
import { mcpHandler } from "@/lib/mcp/server"

// Better Auth checks the bearer token (JWKS signature, issuer, audience,
// expiry) and answers 401 with the RFC 9728 challenge. The token's sub is
// the member every tool acts as.
export const POST = requireMcpAuth(
  auth,
  (request, claims) =>
    mcpHandler.fetch(request, {
      authInfo: {
        token: "",
        clientId: String(claims.azp ?? claims.client_id ?? ""),
        scopes: String(claims.scope ?? "")
          .split(" ")
          .filter(Boolean),
        expiresAt: claims.exp,
        extra: { userId: claims.sub },
      },
    }),
  { resource: mcpResource }
)
