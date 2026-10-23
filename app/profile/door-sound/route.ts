import { runAction } from "@/lib/actions/define"
import { getMyDoorSound } from "@/lib/actions/door-greetings"
import { getSession } from "@/lib/auth/session"

// The member's own door sound, for the preview on /profile.
export async function GET() {
  const session = await getSession()
  if (!session) return new Response("Unauthorized", { status: 401 })
  const { sound } = await runAction(
    getMyDoorSound,
    { userId: session.user.id, via: "web" },
    {}
  )
  if (!sound) return new Response("Not found", { status: 404 })
  return new Response(Buffer.from(sound.base64, "base64"), {
    headers: {
      "Content-Type": sound.contentType,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
