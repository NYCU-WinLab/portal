// Autoplay: when the queue runs dry, music recommends the next song itself,
// from what YouTube Music would play after a song members picked. The seed
// takes turns among the last few songs a member added, so the music stays
// near what the lab chose instead of drifting one recommendation at a time.
// It never picks a song that played or waited in the last few hours, one
// that was skipped as a recommendation lately, a live stream or a clip.
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  ne,
  or,
} from "drizzle-orm"

import { announceChange } from "@/lib/actions/changes"
import {
  inQueue,
  logActivity,
  playerRow,
  saveTracks,
  sortKeys,
} from "@/lib/actions/music-queue"
import { db } from "@/lib/db"
import { musicQueueItems } from "@/lib/db/schema"
import { emitErrorLog, traced } from "@/lib/otel"
import { upNext, type Track } from "@/lib/youtube"

const SEEDS = 5
const RECENT_MS = 3 * 3600 * 1000
const SKIPPED_MS = 7 * 86400 * 1000
const MIN_S = 120
const MAX_S = 600
// Picks at random among the first few, so two runs differ.
const TOP = 5

let filling: Promise<void> | null = null

/** Adds a recommended song when autoplay is on and nothing waits. Safe to
 * call after any change: one fill runs at a time, and errors only log. */
export function fillQueue() {
  filling ??= traced("autoplay fill", {}, fill)
    .catch((error) => emitErrorLog(error, { "autoplay.step": "fill" }))
    .finally(() => {
      filling = null
    })
  return filling
}

async function waiting() {
  const [row] = await db
    .select({ n: count() })
    .from(musicQueueItems)
    .where(eq(musicQueueItems.status, "queued"))
  return (row?.n ?? 0) > 0
}

async function fill() {
  const state = await playerRow()
  if (!state?.autoplay || (await waiting())) return

  const picked = await db
    .select({ videoId: musicQueueItems.videoId })
    .from(musicQueueItems)
    .where(
      and(
        isNotNull(musicQueueItems.addedBy),
        ne(musicQueueItems.addedAs, "auto")
      )
    )
    .orderBy(desc(musicQueueItems.createdAt))
    .limit(SEEDS * 4)
  const seeds = [...new Set(picked.map((p) => p.videoId))].slice(0, SEEDS)
  if (!seeds.length) return

  const now = Date.now()
  const avoid = await db
    .select({ videoId: musicQueueItems.videoId })
    .from(musicQueueItems)
    .where(
      or(
        inArray(musicQueueItems.status, ["queued", "playing"]),
        gt(musicQueueItems.createdAt, new Date(now - RECENT_MS)),
        and(
          eq(musicQueueItems.addedAs, "auto"),
          eq(musicQueueItems.status, "skipped"),
          gt(musicQueueItems.endedAt, new Date(now - SKIPPED_MS))
        )
      )
    )
  const skip = new Set(avoid.map((a) => a.videoId))
  const [{ n: autos } = { n: 0 }] = await db
    .select({ n: count() })
    .from(musicQueueItems)
    .where(eq(musicQueueItems.addedAs, "auto"))

  let choice: Track | null = null
  for (let i = 0; i < seeds.length && !choice; i++) {
    const seed = seeds[(autos + i) % seeds.length]
    const options = (await upNext(seed)).filter(
      (t) =>
        !skip.has(t.videoId) &&
        t.durationS !== null &&
        t.durationS >= MIN_S &&
        t.durationS <= MAX_S
    )
    if (options.length)
      choice =
        options[Math.floor(Math.random() * Math.min(TOP, options.length))]
  }
  if (!choice) return

  const track = choice
  const added = await inQueue(async (tx) => {
    // A member may have added a song meanwhile.
    const [row] = await tx
      .select({ n: count() })
      .from(musicQueueItems)
      .where(eq(musicQueueItems.status, "queued"))
    if ((row?.n ?? 0) > 0) return false
    await saveTracks(tx, [track])
    const [item] = await tx
      .insert(musicQueueItems)
      .values({
        videoId: track.videoId,
        sort: (await sortKeys(tx)).end,
        addedBy: null,
        addedAs: "auto",
      })
      .returning({ id: musicQueueItems.id })
    await logActivity(tx, { userId: null, kind: "auto", itemId: item.id })
    return true
  })
  if (added) await announceChange("autoplay").catch(() => {})
}
