import { getSessionCookie } from "better-auth/cookies"
import { NextResponse, type NextRequest } from "next/server"

// A fast first gate: no session cookie, no page. Pages still check the
// session itself (requireActor); a cookie alone proves nothing.
export function proxy(request: NextRequest) {
  // music.winlab.tw was its own site; its pages now live under /music.
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (host === "music.winlab.tw")
    return NextResponse.redirect(
      `https://portal.winlab.tw/music${request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname}`,
      301
    )
  if (getSessionCookie(request)) return NextResponse.next()
  // The change stream also takes an API key (the Mac app); the route
  // checks it.
  if (
    request.nextUrl.pathname === "/api/events" &&
    request.headers.has("authorization")
  )
    return NextResponse.next()
  const url = new URL("/sign-in", request.url)
  url.searchParams.set(
    "next",
    request.nextUrl.pathname + request.nextUrl.search
  )
  return NextResponse.redirect(url)
}

export const config = {
  // Open: sign-in and consent (they handle their own state), the auth and
  // MCP endpoints (they answer with OAuth errors, not redirects), Keycloak's
  // back-channel logout (a signed token), the card
  // reader's bridge (its own secret), discovery documents and static files,
  // including the door's home-screen manifest and icons.
  matcher: [
    "/((?!(?:sign-in|consent|api/auth|api/keycloak/backchannel-logout|api/door/(?:events|greetings|meeting|sounds|voice|open)|api/rooms|api/actions|api/music/player|api/developers|rooms/join|mcp|\\.well-known|_next/static|_next/image)(?:/|$)|icon\\.png$|apple-icon\\.png$|door/(?:manifest\\.webmanifest|[\\w-]+\\.png)$).*)",
  ],
}
