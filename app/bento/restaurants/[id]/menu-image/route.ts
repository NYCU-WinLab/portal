import { getBentoMenuImage } from "@/lib/actions/bento-restaurants"
import { runAction } from "@/lib/actions/define"
import { getSession } from "@/lib/auth/session"

// The menu photo, for members signed in; the page links here.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return new Response("Unauthorized", { status: 401 })
  const { id } = await params
  const { image } = await runAction(
    getBentoMenuImage,
    { userId: session.user.id, via: "web" },
    { restaurantId: id }
  ).catch(() => ({ image: null }))
  if (!image) return new Response("Not found", { status: 404 })
  return new Response(Buffer.from(image.base64, "base64"), {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
