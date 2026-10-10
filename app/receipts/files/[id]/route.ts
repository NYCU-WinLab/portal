import { runAction } from "@/lib/actions/define"
import { getReceiptFile } from "@/lib/actions/receipts"
import { getSession } from "@/lib/auth/session"

// One receipt as a PDF: inline to read, ?download to save.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return new Response("Unauthorized", { status: 401 })
  const { id } = await params
  const file = await runAction(
    getReceiptFile,
    { userId: session.user.id, via: "web" },
    { id }
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
    },
  })
}
