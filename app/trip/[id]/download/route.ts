import { runAction } from "@/lib/actions/define"
import { exportTripFiles } from "@/lib/actions/trip"
import { getSession } from "@/lib/auth/session"

// A trip's files as a zip for trip admins; ?member=<id> for one member.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return new Response("Unauthorized", { status: 401 })
  const { id } = await params
  const member = new URL(request.url).searchParams.get("member") ?? undefined
  const zip = await runAction(
    exportTripFiles,
    { userId: session.user.id, via: "web" },
    { tripId: id, userId: member }
  ).catch(() => null)
  if (!zip) return new Response("Not found", { status: 404 })
  return new Response(Buffer.from(zip.base64, "base64"), {
    headers: {
      "Content-Type": zip.contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zip.filename)}`,
      "Cache-Control": "private, no-store",
    },
  })
}
