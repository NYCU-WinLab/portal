import { runAction } from "@/lib/actions/define"
import { getDoorSound } from "@/lib/actions/door-sounds"
import { getSession } from "@/lib/auth/session"

// A pool sound, for members signed in; the players on /door/sounds and
// /profile load it. Its bytes never change, so it caches for a day.
export async function GET(
  _request: Request,
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
  return new Response(Buffer.from(sound.base64, "base64"), {
    headers: {
      "Content-Type": sound.contentType,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
