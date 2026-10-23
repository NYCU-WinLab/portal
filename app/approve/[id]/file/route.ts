import { runAction } from "@/lib/actions/define"
import { getApproveFile } from "@/lib/actions/approve"
import { getSession } from "@/lib/auth/session"

// A document's original PDF, for the page to draw its fields over.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return new Response("Unauthorized", { status: 401 })
  const { id } = await params
  const file = await runAction(
    getApproveFile,
    { userId: session.user.id, via: "web" },
    { id }
  ).catch(() => null)
  if (!file) return new Response("Not found", { status: 404 })
  return new Response(Buffer.from(file.base64, "base64"), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
