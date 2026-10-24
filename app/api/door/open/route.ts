import { authenticate, runWithKey } from "@/lib/api-key-http"

// POST /api/door/open with an API key allowed into the door opens the lab
// door as the key's owner: the same as POST /api/actions/open_door, kept
// for the shortcuts made before API keys. Only POST: a link someone
// follows (a GET) must never open the door.

export async function POST(request: Request) {
  const holder = await authenticate(request)
  if (holder instanceof Response) return holder
  const response = await runWithKey(request, holder, "open_door", {})
  if (!response.ok) return response
  return Response.json(
    { opened: true },
    { headers: { "cache-control": "no-store" } }
  )
}
