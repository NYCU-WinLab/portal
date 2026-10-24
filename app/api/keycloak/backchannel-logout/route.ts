import { BadLogoutToken, backchannelLogout } from "@/lib/auth/backchannel"
import { traced } from "@/lib/otel"

// Keycloak's back-channel logout URL for the portal client: a form post
// with logout_token. 200 when applied, 400 for a token that does not check.

const noStore = { "cache-control": "no-store" }

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null)
  const token = form?.get("logout_token")
  if (typeof token !== "string" || !token)
    return Response.json(
      { error: "missing logout_token" },
      { status: 400, headers: noStore }
    )
  try {
    const ended = await traced("keycloak backchannel logout", {}, () =>
      backchannelLogout(token)
    )
    return Response.json({ ended }, { headers: noStore })
  } catch (error) {
    if (error instanceof BadLogoutToken)
      return Response.json(
        { error: error.message },
        { status: 400, headers: noStore }
      )
    throw error
  }
}
