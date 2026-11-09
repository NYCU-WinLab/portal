import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { linkGoogleCalendar } from "@/lib/actions/calendar"
import { runAction } from "@/lib/actions/define"
import { getSession } from "@/lib/auth/session"
import { sameKey } from "@/lib/calendar-crypto"
import { CONSENT_COOKIE, MissingScope } from "@/lib/google-calendar"

// Google sends the member back here. The state must match the cookie set
// by /connect for the same signed-in member, or nothing is linked.

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) redirect("/sign-in?next=/calendar/settings")
  const jar = await cookies()
  const [state, verifier, userId] = (
    jar.get(CONSENT_COOKIE)?.value ?? ""
  ).split(".")
  jar.delete({ name: CONSENT_COOKIE, path: "/" })
  const params = new URL(request.url).searchParams
  const code = params.get("code")
  const given = params.get("state") ?? ""
  if (
    !state ||
    !verifier ||
    userId !== session.user.id ||
    !sameKey(given, state)
  )
    redirect("/calendar/settings?error=state")
  if (!code) redirect("/calendar/settings?error=denied")
  let failure: "scope" | "failed" | null = null
  try {
    await runAction(
      linkGoogleCalendar,
      { userId: session.user.id, via: "web" },
      { code, verifier }
    )
  } catch (error) {
    failure = error instanceof MissingScope ? "scope" : "failed"
  }
  redirect(
    failure ? `/calendar/settings?error=${failure}` : "/calendar/settings"
  )
}
