// The queue's shared steps, used by member actions (music.ts) and by the
// player (music-player.ts). Every write runs in withQueue: one transaction that
// holds the player row, so two members pressing at once take turns.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"

import { fillQueue } from "@/lib/actions/music-autoplay"
import { db } from "@/lib/db"
import {
  musicActivities,
  musicPlayer,
  musicQueueItems,
  musicTracks,
  user,
} from "@/lib/db/schema"
import type { Track } from "@/lib/youtube"

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Runs fn holding the one player row; afterwards the queue has a current
 * item whenever it has any item, and the player's version moves on. A queue
 * left with nothing waiting gets a recommendation after the commit. */
export async function withQueue<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await inQueue(fn)
  setTimeout(() => void fillQueue(), 0)
  return result
}

/** withQueue without the recommendation, for autoplay itself. */
export async function inQueue<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.insert(musicPlayer).values({ id: 1 }).onConflictDoNothing()
    await tx.execute(sql`select 1 from ${musicPlayer} where id = 1 for update`)
    const result = await fn(tx)
    await promote(tx)
    await tx
      .update(musicPlayer)
      .set({ version: sql`${musicPlayer.version} + 1`, updatedAt: new Date() })
      .where(eq(musicPlayer.id, 1))
    return result
  })
}

/** Takes waiting recommendations out: a member's song goes first, and
 * autoplay recommends again once the queue is dry. */
export async function dropRecommendations(tx: Tx) {
  await tx
    .update(musicQueueItems)
    .set({ status: "removed", endedAt: new Date() })
    .where(
      and(
        eq(musicQueueItems.status, "queued"),
        eq(musicQueueItems.addedAs, "auto")
      )
    )
}

/** The playing item, if any. */
export async function currentItem(tx: Tx) {
  const [item] = await tx
    .select()
    .from(musicQueueItems)
    .where(eq(musicQueueItems.status, "playing"))
    .limit(1)
  return item ?? null
}

// With nothing playing, the first queued item starts.
async function promote(tx: Tx) {
  if (await currentItem(tx)) return
  const [next] = await tx
    .select({ id: musicQueueItems.id })
    .from(musicQueueItems)
    .where(eq(musicQueueItems.status, "queued"))
    .orderBy(asc(musicQueueItems.sort))
    .limit(1)
  if (!next) return
  await tx
    .update(musicQueueItems)
    .set({ status: "playing", startedAt: new Date() })
    .where(eq(musicQueueItems.id, next.id))
  await tx
    .update(musicPlayer)
    .set({ positionS: 0, positionAt: null, state: "loading", error: null })
    .where(eq(musicPlayer.id, 1))
}

/** Where the playing song is now, in seconds, from the player's last
 * report and the time since. */
export function positionNow(state: typeof musicPlayer.$inferSelect) {
  const running =
    state.state === "playing" && !state.paused && state.positionAt !== null
  return (
    state.positionS +
    (running ? (Date.now() - state.positionAt!.getTime()) / 1000 : 0)
  )
}

export async function playerRow(tx: Tx | typeof db = db) {
  const [row] = await tx.select().from(musicPlayer).where(eq(musicPlayer.id, 1))
  return row ?? null
}

/** Sort keys for the end and the front of the queue. */
export async function sortKeys(tx: Tx) {
  const [row] = await tx
    .select({
      min: sql<number | null>`min(${musicQueueItems.sort})`,
      max: sql<number | null>`max(${musicQueueItems.sort})`,
    })
    .from(musicQueueItems)
    .where(eq(musicQueueItems.status, "queued"))
  return {
    end: (row?.max ?? 0) + 1,
    front: (row?.min ?? 0) - 1,
  }
}

export async function saveTracks(tx: Tx, list: Track[]) {
  if (!list.length) return
  await tx
    .insert(musicTracks)
    .values(list)
    .onConflictDoUpdate({
      target: musicTracks.videoId,
      set: {
        title: sql`excluded.title`,
        artist: sql`excluded.artist`,
        durationS: sql`excluded.duration_s`,
        thumbnail: sql`excluded.thumbnail`,
      },
    })
}

/** The waiting or playing item of a video, if it is already in the queue. */
export async function liveItemOf(tx: Tx, videoId: string) {
  const [item] = await tx
    .select()
    .from(musicQueueItems)
    .where(
      and(
        eq(musicQueueItems.videoId, videoId),
        inArray(musicQueueItems.status, ["queued", "playing"])
      )
    )
    .limit(1)
  return item ?? null
}

export async function logActivity(
  tx: Tx,
  entry: typeof musicActivities.$inferInsert
) {
  await tx.insert(musicActivities).values(entry)
}

/** Items with their song and who added, skipped or removed them. */
export async function describeItems(
  tx: Tx | typeof db,
  items: (typeof musicQueueItems.$inferSelect)[]
) {
  if (!items.length) return []
  const [songs, people] = await Promise.all([
    tx
      .select()
      .from(musicTracks)
      .where(
        inArray(
          musicTracks.videoId,
          items.map((item) => item.videoId)
        )
      ),
    tx
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(
        inArray(user.id, [
          ...new Set(
            items.flatMap((item) =>
              [item.addedBy, item.endedBy].filter((id): id is string => !!id)
            )
          ),
          "00000000-0000-0000-0000-000000000000",
        ])
      ),
  ])
  const song = new Map(songs.map((s) => [s.videoId, s]))
  const name = new Map(people.map((p) => [p.id, p.name]))
  return items.map((item) => ({
    id: item.id,
    status: item.status,
    addedAs: item.addedAs,
    fromPlaylist: item.playlistId !== null,
    track: song.get(item.videoId)!,
    addedBy: item.addedBy ? (name.get(item.addedBy) ?? null) : null,
    endedBy: item.endedBy ? (name.get(item.endedBy) ?? null) : null,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
  }))
}

export async function queuedItems(tx: Tx | typeof db = db) {
  return tx
    .select()
    .from(musicQueueItems)
    .where(eq(musicQueueItems.status, "queued"))
    .orderBy(asc(musicQueueItems.sort))
}

/** Volume changes by one member within this long before their last one read as
 * one: the level they settled on. */
const VOLUME_RUN_MS = 60_000

export async function recentActivities(limit: number) {
  const rows = await db
    .select({
      id: musicActivities.id,
      kind: musicActivities.kind,
      detail: musicActivities.detail,
      createdAt: musicActivities.createdAt,
      userId: musicActivities.userId,
      who: user.name,
      title: musicTracks.title,
    })
    .from(musicActivities)
    .leftJoin(user, eq(user.id, musicActivities.userId))
    .leftJoin(musicQueueItems, eq(musicQueueItems.id, musicActivities.itemId))
    .leftJoin(musicTracks, eq(musicTracks.videoId, musicQueueItems.videoId))
    .orderBy(desc(musicActivities.id))
    // Enough to fill the page after runs of volume clicks fold up.
    .limit(limit * 5)
  const out: typeof rows = []
  for (const row of rows) {
    const last = out.at(-1)
    const sameRun =
      last?.kind === "volume" &&
      row.kind === "volume" &&
      last.userId === row.userId &&
      last.createdAt.getTime() - row.createdAt.getTime() < VOLUME_RUN_MS
    if (!sameRun) out.push(row)
  }
  return out.slice(0, limit).map((row) => ({ ...row, userId: undefined }))
}
