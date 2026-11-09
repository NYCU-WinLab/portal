import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { getSession } from "@/lib/auth/session"
import {
  CONSENT_COOKIE,
  consentUrl,
  googleCalendarConfigured,
  newConsent,
} from "@/lib/google-calendar"

// Starts linking Google Calendar: keeps the state and PKCE verifier in a
// short-lived cookie bound to the member, then sends them to Google.

export async function GET() {
  const session = await getSession()
  if (!session) redirect("/sign-in?next=/calendar/settings")
  if (!googleCalendarConfigured())
    redirect("/calendar/settings?error=not-configured")
  const { state, verifier, challenge } = newConsent()
  ;(await cookies()).set(
    CONSENT_COOKIE,
    `${state}.${verifier}.${session.user.id}`,
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    }
  )
  redirect(consentUrl(state, challenge))
}
