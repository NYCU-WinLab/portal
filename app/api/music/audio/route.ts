import { createReadStream } from "node:fs"
import { Readable } from "node:stream"

import { runAction } from "@/lib/actions/define"
import { listQueue, nowPlaying } from "@/lib/actions/music"
import { getSession } from "@/lib/auth/session"
import { fetchAudio } from "@/lib/music-audio"
import { traced } from "@/lib/otel"

// A song's audio for a member who listens in the browser (?id=<videoId>).
// Only the song playing or waiting in the queue, and only a song with a
// length: a live stream has no file. The file comes from the player on the
// lab network, which the portal asks through its state (lib/music-audio.ts),
// so the first request for a song can wait a few seconds.

const error = (message: string, status: number) =>
  Response.json({ error: message }, { status })

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return new Response("Unauthorized", { status: 401 })
  const id = new URL(request.url).searchParams.get("id")
  if (!id) return error("沒有指定歌", 400)

  const actor = { userId: session.user.id, via: "web" as const }
  const [playing, queue] = await Promise.all([
    runAction(nowPlaying, actor, {}),
    runAction(listQueue, actor, {}),
  ])
  const track = [playing.current, ...queue.items].find(
    (item) => item?.track.videoId === id
  )?.track
  if (!track) return error("這首不在佇列裡", 404)
  if (!track.durationS) return error("直播沒有音檔", 422)

  return traced("music audio", { "track.id": id }, async () => {
    try {
      const file = await fetchAudio(id, request.signal)
      return new Response(
        Readable.toWeb(
          createReadStream(file.path)
        ) as unknown as ReadableStream,
        {
          headers: {
            "Content-Type": file.type,
            "Content-Length": String(file.size),
            "Cache-Control": "private, max-age=600",
            "X-Content-Type-Options": "nosniff",
          },
        }
      )
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "取不到音檔"
      return error(message, message === "等不到音檔" ? 504 : 502)
    }
  })
}
