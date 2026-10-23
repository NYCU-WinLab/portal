import { runAction } from "@/lib/actions/define"
import { getDoorVoiceClip } from "@/lib/actions/door-phrases"
import { getSession } from "@/lib/auth/session"

// A voice clip, for door admins signed in; the players on /door/voice load
// it. A re-recorded text gets a new clip id, so a clip never changes.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return new Response("Unauthorized", { status: 401 })
  const { id } = await params
  const clip = await runAction(
    getDoorVoiceClip,
    { userId: session.user.id, via: "web" },
    { id }
  ).catch(() => null)
  if (!clip) return new Response("Not found", { status: 404 })
  return new Response(Buffer.from(clip.base64, "base64"), {
    headers: {
      "Content-Type": clip.contentType,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
