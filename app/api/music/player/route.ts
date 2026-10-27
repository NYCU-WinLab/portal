import { timingSafeEqual } from "node:crypto"

import { z } from "zod"

import { onChange } from "@/lib/actions/changes"
import { playerReport, playerState } from "@/lib/actions/music-player"

// The music player on the lab network (music-player/ in this repo) talks
// only to this route, with MUSIC_PLAYER_TOKEN. GET is server-sent events:
// the player state at once, then again each time its version changes. POST
// reports what the player did.

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

  const encoder = new TextEncoder()
  let stop = () => {}
  const stream = new ReadableStream({
    async start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          stop()
        }
      }
      let sent = -1
      // Changes arrive faster than a state read; one read at a time, and
      // one more after it when something changed meanwhile.
      let reading: Promise<void> | null = null
      let again = false
      const push = () => {
        if (reading) {
          again = true
          return
        }
        reading = (async () => {
          do {
            again = false
            const state = await playerState()
            if (state.version !== sent) {
              sent = state.version
              send(`data: ${JSON.stringify(state)}\n\n`)
            }
          } while (again)
        })()
          // A state the route cannot read is a broken link: close it, so the
          // player reconnects and counts the failure instead of hearing pings.
          .catch(() => {
            stop()
            try {
              controller.close()
            } catch {}
          })
          .finally(() => {
            reading = null
          })
      }
      send("retry: 3000\n\n")
      const off = await onChange(push)
      push()
      // Keeps proxies from closing a quiet connection.
      const ping = setInterval(() => send(": ping\n\n"), 25_000)
      stop = () => {
        clearInterval(ping)
        off()
      }
      request.signal.addEventListener("abort", () => {
        stop()
        try {
          controller.close()
        } catch {}
      })
    },
    cancel() {
      stop()
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  })
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
