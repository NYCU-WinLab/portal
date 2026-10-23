import { getSessionCookie } from "better-auth/cookies"
import { NextResponse, type NextRequest } from "next/server"

// A fast first gate: no session cookie, no page. Pages still check the
// session itself (requireActor); a cookie alone proves nothing.
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next()
  const url = new URL("/sign-in", request.url)
  url.searchParams.set(
    "next",
    request.nextUrl.pathname + request.nextUrl.search
  )
  return NextResponse.redirect(url)
}

export const config = {
  // Open: sign-in and consent (they handle their own state), the auth and
  // MCP endpoints (they answer with OAuth errors, not redirects), the card
  // reader's bridge (its own secret), discovery documents and static files,
  // including the door's home-screen manifest and icons.
  matcher: [
    "/((?!(?:sign-in|consent|api/auth|api/door/(?:events|greetings|meeting|sounds)|api/rooms|api/developers|rooms/join|mcp|\\.well-known|_next/static|_next/image)(?:/|$)|favicon.ico$|icon.svg$|door/(?:manifest\\.webmanifest|[\\w-]+\\.png)$).*)",
  ],
}
