import { decodeJwt } from "jose"

import { adminAppsOf } from "@/lib/actions/authz"
import { mcpResource } from "@/lib/auth"
import { TokenRefused, verifyKeycloakToken } from "@/lib/auth/keycloak-token"
import { legacyMcp } from "@/lib/auth/legacy-mcp"
import { isLabMember } from "@/lib/auth/member"
import { mcpHandler } from "@/lib/mcp/server"
import { parseToolsets } from "@/lib/mcp/toolsets"

// RFC 9728: a 401 points the client at the metadata, which names Keycloak.
const metadata = new URL(
  "/.well-known/oauth-protected-resource/mcp",
  mcpResource
).toString()

const refuse = (status: number, message: string, error?: string) =>
  Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message }, id: null },
    {
      status,
      headers:
        status === 401
          ? {
              "www-authenticate": `Bearer resource_metadata="${metadata}"${error ? `, error="${error}"` : ""}`,
            }
          : undefined,
    }
  )

// Better Auth's own tokens name this site as issuer.
const issuedHere = (token: string) => {
  try {
    const { iss } = decodeJwt(token)
    return (
      typeof iss === "string" &&
      iss !== process.env.KEYCLOAK_ISSUER &&
      new URL(iss).origin === new URL(mcpResource).origin
    )
  } catch {
    return false
  }
}

// The bearer token is a Keycloak access token for this /mcp. Its member is
// the one every tool acts as.
export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? ""
  const token = header.match(/^Bearer (\S+)$/i)?.[1]
  if (!token) return refuse(401, "sign in required")
  // The unverified issuer only picks the path; each path verifies in full.
  if (issuedHere(token)) return legacyMcp(request)

  let caller
  try {
    caller = await verifyKeycloakToken(token, mcpResource)
  } catch (error) {
    if (!(error instanceof TokenRefused)) throw error
    return refuse(
      error.status,
      error.message,
      error.status === 401 ? "invalid_token" : undefined
    )
  }
  // A valid token is not enough: the member must still be in the lab.
  try {
    if (!(await isLabMember(caller.userId)))
      return refuse(403, "no longer a lab member")
  } catch {
    return refuse(503, "cannot reach Keycloak to check membership")
  }
  let adminApps: string[]
  try {
    adminApps = [...(await adminAppsOf({ userId: caller.userId, via: "mcp" }))]
  } catch {
    return refuse(503, "cannot read the member's admin roles")
  }
  return mcpHandler.fetch(request, {
    authInfo: {
      token: "",
      clientId: caller.clientId,
      scopes: caller.scopes,
      expiresAt: caller.expiresAt,
      extra: {
        userId: caller.userId,
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
}
