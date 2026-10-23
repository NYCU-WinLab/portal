import { panelSound } from "@/lib/actions/door-sounds"
import { soundLinkValid } from "@/lib/door-greeting"

// A pool sound, by the signed link in /api/door/greetings.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const query = new URL(request.url).searchParams
  if (
    !/^[0-9a-f-]{36}$/i.test(id) ||
    !soundLinkValid(id, Number(query.get("exp")), query.get("sig") ?? "")
  )
    return new Response("forbidden", { status: 403 })
  const sound = await panelSound(id)
  if (!sound) return new Response("gone", { status: 410 })
  return new Response(new Uint8Array(sound.bytes), {
    headers: {
      "content-type": sound.type,
      "content-length": String(sound.bytes.length),
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  })
}
