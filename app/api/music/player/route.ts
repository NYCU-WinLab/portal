import { z } from "zod"

import { onChange } from "@/lib/actions/changes"
import {
  playerAuthorized,
  playerReport,
  playerState,
} from "@/lib/actions/music-player"
import { onWanted } from "@/lib/music-audio"

// The music player on the lab network (music-player/ in this repo) talks
// only to this route, with MUSIC_PLAYER_TOKEN. GET is server-sent events:
// the player state at once, then again each time its version changes or the
// songs a browser waits for do. POST reports what the player did.

export async function GET(request: Request) {
  if (!playerAuthorized(request)) return new Response(null, { status: 401 })

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
      let sent = ""
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
            // A read that hangs counts as a failed one.
            const state = await Promise.race([
              playerState(),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error("state read timed out")),
                  10_000
                )
              ),
            ])
            const key = `${state.version}:${state.upload.join(",")}`
            if (key !== sent) {
              sent = key
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
      const offWanted = onWanted(push)
      push()
      // Keeps proxies from closing a quiet connection, and reads the state
      // each time, so a database gone quiet still closes the stream.
      const ping = setInterval(() => {
        send(": ping\n\n")
        push()
      }, 25_000)
      stop = () => {
        clearInterval(ping)
        off()
        offWanted()
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
  if (!playerAuthorized(request)) return new Response(null, { status: 401 })
  const parsed = report.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return new Response(null, { status: 400 })
  await playerReport(parsed.data)
  return new Response(null, { status: 204 })
}
