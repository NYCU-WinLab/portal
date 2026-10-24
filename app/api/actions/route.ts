import { authenticate, listForKey, noStore } from "@/lib/api-key-http"

// GET /api/actions: what this key can call, each with its input schema.

export async function GET(request: Request) {
  const holder = await authenticate(request)
  if (holder instanceof Response) return holder
  return Response.json(
    { actions: await listForKey(holder) },
    { headers: noStore }
  )
}
