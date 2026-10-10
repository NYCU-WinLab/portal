import { runAction } from "@/lib/actions/define"
import { getTripFile } from "@/lib/actions/trip"
import { getSession } from "@/lib/auth/session"

// One trip file as a PDF: inline to read, ?download to save.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return new Response("Unauthorized", { status: 401 })
  const { id } = await params
  const file = await runAction(
    getTripFile,
    { userId: session.user.id, via: "web" },
    { fileId: id }
  ).catch(() => null)
  if (!file) return new Response("Not found", { status: 404 })
  const disposition = new URL(request.url).searchParams.has("download")
    ? "attachment"
    : "inline"
  return new Response(Buffer.from(file.base64, "base64"), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // A member's PDF opens on the portal's origin; keep it from running
      // anything there.
      "Content-Security-Policy": "sandbox",
    },
  })
}
