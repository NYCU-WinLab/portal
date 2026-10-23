import { runAction } from "@/lib/actions/define"
import { getDoorSound } from "@/lib/actions/door-sounds"
import { getSession } from "@/lib/auth/session"

// A pool sound, for members signed in; the players on /door/sounds and
// /profile load it. The browser keeps it and asks again each time, so a
// replaced file plays at once and an unchanged one costs a 304.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return new Response("Unauthorized", { status: 401 })
  const { id } = await params
  const sound = await runAction(
    getDoorSound,
    { userId: session.user.id, via: "web" },
    { id }
  ).catch(() => null)
  if (!sound) return new Response("Not found", { status: 404 })
  const etag = `"${sound.version}"`
  const headers = {
    "Cache-Control": "private, no-cache",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  }
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers })
  return new Response(Buffer.from(sound.base64, "base64"), {
    headers: { ...headers, "Content-Type": sound.contentType },
  })
}
