import { calendarFeed } from "@/lib/actions/calendar"

// A subscription link: /api/calendar/feed/<viewer>/<key>/<owner>.ics. The
// key is the viewer's own, so the owner's visibility and the viewer still
// being in the lab are checked on every fetch.

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ viewer: string; key: string; owner: string }> }
) {
  const { viewer, key, owner } = await params
  let body: string | null
  try {
    body = await calendarFeed(viewer, key, owner.replace(/\.ics$/, ""))
  } catch {
    return new Response("unavailable", { status: 503 })
  }
  if (!body) return new Response("not found", { status: 404 })
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, no-store",
    },
  })
}
