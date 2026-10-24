import { authenticate, readInput, runWithKey } from "@/lib/api-key-http"

// POST /api/actions/<name> with "Authorization: Bearer wak_…" and the
// action's input as a JSON body runs that action as the key's owner. The
// names and inputs are the MCP tools'; GET /api/actions lists them.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const holder = await authenticate(request)
  if (holder instanceof Response) return holder
  const body = await readInput(request)
  if (body instanceof Response) return body
  return runWithKey(request, holder, (await params).name, body.input)
}
