import { timingSafeEqual } from "node:crypto"

import { z } from "zod"

import { onChange } from "@/lib/actions/changes"
import {
  playerReport,
  playerState,
  playerVersion,
} from "@/lib/actions/music-player"

// The music player on the lab network (music-player/ in this repo) talks
// only to this route, with MUSIC_PLAYER_TOKEN. GET long-polls: it answers at once when the
// version differs from ?version, else when anything changes, else after
// 25 seconds. POST reports what the player did.

const WAIT_MS = 25_000

function authorized(request: Request) {
  const token = process.env.MUSIC_PLAYER_TOKEN
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "")
  if (!token || !given) return false
  const a = Buffer.from(token)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 401 })
  const known = Number(new URL(request.url).searchParams.get("version") ?? -1)
  if ((await playerVersion()) === known) {
    await new Promise<void>((resolve) => {
      let off = () => {}
      const done = () => {
        clearTimeout(timer)
        off()
        resolve()
      }
      const timer = setTimeout(done, WAIT_MS)
      request.signal.addEventListener("abort", done)
      onChange(async () => {
        if ((await playerVersion()) !== known) done()
      })
        .then((stop) => {
          off = stop
        })
        .catch(done)
    })
  }
  return Response.json(await playerState())
}

const report = z.object({
  itemId: z.uuid().nullable(),
  event: z.enum([
    "idle",
    "loading",
    "playing",
    "waiting",
    "ended",
    "failed",
    "taken",
  ]),
  positionS: z.number().min(0).max(86_400).optional(),
  error: z.string().max(1000).optional(),
})

export async function POST(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 401 })
  const parsed = report.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return new Response(null, { status: 400 })
  await playerReport(parsed.data)
  return new Response(null, { status: 204 })
}
