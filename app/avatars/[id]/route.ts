import { runAction } from "@/lib/actions/define"
import { getMemberAvatar } from "@/lib/actions/avatars"
import { getSession } from "@/lib/auth/session"

// A member's avatar, for signed-in members only; ?size=large is the
// profile's. With ?v=<version> the url never changes content and caches for
// a year. Without it (the avatar stacks, which know only the member id) the
// browser asks again each time and gets a 304, so a new picture shows at
// once. A member with none gets a 404 for a minute: the initial shows.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return new Response("Unauthorized", { status: 401 })
  const { id } = await params
  const query = new URL(request.url).searchParams
  const size = query.get("size") === "large" ? "large" : "small"
  const avatar = await runAction(
    getMemberAvatar,
    { userId: session.user.id, via: "web" },
    { user_id: id, size }
  ).catch(() => "failed" as const)
  // A database hiccup is not "no avatar": nothing is cached for it.
  if (avatar === "failed")
    return new Response("Unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    })
  if (!avatar)
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "private, max-age=60" },
    })
  const etag = `"${avatar.version}-${size}"`
  const headers = {
    "Cache-Control": query.has("v")
      ? "private, max-age=31536000, immutable"
      : "private, no-cache",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  }
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers })
  return new Response(Buffer.from(avatar.base64, "base64"), {
    headers: { ...headers, "Content-Type": avatar.contentType },
  })
}
