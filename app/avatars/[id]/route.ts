import { runAction } from "@/lib/actions/define"
import { getMemberAvatar } from "@/lib/actions/avatars"
import { getSession } from "@/lib/auth/session"

// A member's avatar, for signed-in members only; ?size=large is the
// profile's. The browser keeps it but asks again every time, so the session
// is checked on each view and a new picture shows at once (a 304 when
// unchanged). A member with none gets a 404 for a minute: the initial shows.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "private, max-age=60" },
  })
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return new Response("Unauthorized", { status: 401 })
  const { id } = await params
  if (!UUID.test(id)) return notFound()
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
  if (!avatar) return notFound()
  const etag = `"${avatar.version}-${size}"`
  const headers = {
    "Cache-Control": "private, no-cache",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  }
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers })
  return new Response(Buffer.from(avatar.base64, "base64"), {
    headers: { ...headers, "Content-Type": avatar.contentType },
  })
}
