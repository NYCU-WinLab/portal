// The player's side: the program on the lab network that streams to the
// HomePod. It is not a member, so these are not actions; /api/music/player calls
// them after checking PLAYER_TOKEN. It follows what members asked for
// (playerState) and says what it did (playerReport).
import { and, asc, eq, gt } from "drizzle-orm"

import { announceChange } from "@/lib/actions/changes"
import { currentItem, playerRow, withQueue } from "@/lib/actions/music-queue"
import { db } from "@/lib/db"
import { musicPlayer, musicQueueItems, musicTracks } from "@/lib/db/schema"
import { traced } from "@/lib/otel"

export async function playerVersion() {
  return (await playerRow())?.version ?? 0
}

/** What the player should do now: the song and where to start, paused,
 * volume, and the next songs to fetch ahead. */
export async function playerState() {
  const state = await playerRow()
  const rows = await db
    .select({
      itemId: musicQueueItems.id,
      status: musicQueueItems.status,
      videoId: musicQueueItems.videoId,
      startAtS: musicQueueItems.resumeAtS,
      title: musicTracks.title,
      artist: musicTracks.artist,
      durationS: musicTracks.durationS,
    })
    .from(musicQueueItems)
    .innerJoin(musicTracks, eq(musicTracks.videoId, musicQueueItems.videoId))
    .where(eq(musicQueueItems.status, "playing"))
    .limit(1)
  // Songs to fetch ahead; a live stream has no file to fetch.
  const upcoming = await db
    .select({ videoId: musicQueueItems.videoId })
    .from(musicQueueItems)
    .innerJoin(musicTracks, eq(musicTracks.videoId, musicQueueItems.videoId))
    .where(
      and(eq(musicQueueItems.status, "queued"), gt(musicTracks.durationS, 0))
    )
    .orderBy(asc(musicQueueItems.sort))
    .limit(2)
  const [current] = rows
  return {
    version: state?.version ?? 0,
    paused: state?.paused ?? false,
    volume: state?.volume ?? 40,
    current: current
      ? {
          itemId: current.itemId,
          videoId: current.videoId,
          title: current.title,
          artist: current.artist,
          durationS: current.durationS,
          startAtS: current.startAtS,
        }
      : null,
    upcoming: upcoming.map((u) => u.videoId),
  }
}

export type PlayerReport = {
  itemId: string | null
  event:
    "idle" | "loading" | "playing" | "waiting" | "ended" | "failed" | "taken"
  positionS?: number
  error?: string
}

/** Records what the player did. ended and failed move the queue on; taken
 * (another AirPlay source kept the HomePod) pauses it. */
export async function playerReport(report: PlayerReport) {
  return traced(
    `player ${report.event}`,
    { "musicPlayer.event": report.event, "item.id": report.itemId ?? "" },
    async () => {
      const now = new Date()
      if (
        report.event === "ended" ||
        report.event === "failed" ||
        report.event === "taken"
      ) {
        await withQueue(async (tx) => {
          const playing = await currentItem(tx)
          const mine = playing && playing.id === report.itemId
          if (mine && report.event !== "taken")
            await tx
              .update(musicQueueItems)
              .set({
                status: report.event === "ended" ? "done" : "skipped",
                endedAt: now,
              })
              .where(eq(musicQueueItems.id, playing.id))
          if (mine && report.event === "taken")
            await tx
              .update(musicQueueItems)
              .set({ resumeAtS: report.positionS ?? 0 })
              .where(eq(musicQueueItems.id, playing.id))
          await tx
            .update(musicPlayer)
            .set({
              seenAt: now,
              ...(report.event === "taken"
                ? {
                    paused: true,
                    state: "idle" as const,
                    error: "HomePod 被其他 AirPlay 接走，已暫停",
                  }
                : report.event === "failed"
                  ? { error: report.error?.slice(0, 300) ?? "播放失敗" }
                  : {}),
            })
            .where(eq(musicPlayer.id, 1))
        })
        await announceChange(`player_${report.event}`).catch(() => {})
        return
      }

      const before = await playerRow()
      await db
        .update(musicPlayer)
        .set({
          seenAt: now,
          state: report.event,
          positionS: report.positionS ?? 0,
          positionAt: now,
          ...(report.event === "playing" ? { error: null } : {}),
        })
        .where(eq(musicPlayer.id, 1))
      if (report.itemId && report.positionS !== undefined)
        await db
          .update(musicQueueItems)
          .set({ resumeAtS: report.positionS })
          .where(
            and(
              eq(musicQueueItems.id, report.itemId),
              eq(musicQueueItems.status, "playing")
            )
          )
      // Pages only need to hear when the state changes; they move the
      // progress bar themselves from positionAt.
      const wasOnline =
        before?.seenAt && now.getTime() - before.seenAt.getTime() < 45_000
      if (before?.state !== report.event || !wasOnline)
        await announceChange(`player_${report.event}`).catch(() => {})
    }
  )
}
