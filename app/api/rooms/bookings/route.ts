import { bookingsFeed } from "@/lib/actions/rooms-meetings"
import {
  addDays,
  daysBetween,
  isCalendarDay,
  todayInTaipei,
} from "@/lib/rooms/time"

import { bearer, sameSecret } from "../bearer"

// The booking feed GitLab polls, with ROOMS_API_SECRET. The window is
// explicit (from, to; 30 days by default, 90 at most).

export async function GET(request: Request) {
  const secret = process.env.ROOMS_API_SECRET
  const token = bearer(request.headers.get("authorization"))
  if (!secret || !token || !sameSecret(token, secret))
    return Response.json({ error: "unauthorized" }, { status: 401 })
  const params = new URL(request.url).searchParams
  const from = (params.get("from") ?? todayInTaipei()).slice(0, 10)
  const to = (params.get("to") ?? addDays(from, 30)).slice(0, 10)
  if (!isCalendarDay(from) || !isCalendarDay(to))
    return Response.json(
      { error: "from and to are YYYY-MM-DD" },
      { status: 400 }
    )
  if (to < from || daysBetween(from, to) > 90)
    return Response.json({ error: "window is 0 to 90 days" }, { status: 400 })
  return Response.json(
    { window: { from, to }, bookings: await bookingsFeed(from, to) },
    { headers: { "cache-control": "no-store" } }
  )
}
