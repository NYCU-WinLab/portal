import { and, desc, eq, isNotNull } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import {
  currentItem,
  describeItems,
  dropRecommendations,
  liveItemOf,
  logActivity,
  playerRow,
  positionNow,
  queuedItems,
  recentActivities,
  saveTracks,
  sortKeys,
  type Tx,
  withQueue,
} from "@/lib/actions/music-queue"
import { db } from "@/lib/db"
import {
  musicLyrics,
  musicPlayer,
  musicQueueItems,
  musicTracks,
} from "@/lib/db/schema"
import * as bilibili from "@/lib/bilibili"
import { findLyrics, parseLrc } from "@/lib/lrclib"
import * as twitch from "@/lib/twitch"
import {
  getPlaylist,
  getTrack,
  parseLink,
  PLAYLIST_LIMIT,
  searchSongs,
  type Track,
} from "@/lib/youtube"

/** The player counts as online when it reported within this long. */
const ONLINE_MS = 45_000

// A YouTube video id as is; other sources carry a prefix (bilibili:, twitch:).
const videoId = z.union(
  [
    z.string().regex(/^[\w-]{11}$/),
    z.string().regex(new RegExp(bilibili.ID_PATTERN)),
    z.string().regex(new RegExp(twitch.ID_PATTERN)),
  ],
  "不是 YouTube、Bilibili 影片或 Twitch 頻道"
)

/** One song's details from the source its id names. */
function trackOf(id: string): Promise<Track> {
  if (id.startsWith("bilibili:")) return bilibili.getTrack(id)
  if (id.startsWith("twitch:")) return twitch.getTrack(id)
  return getTrack(id)
}
const itemId = z.uuid("找不到這首")

export const nowPlaying = defineAction({
  name: "now_playing",
  title: "正在播放",
  description:
    "The song playing on the lab HomePod: title, artist, who added it and how (queue, next or cut_in), position in seconds, paused, volume (0-100), autoplay (recommend a song when the queue runs dry) and whether the player on the lab network is online.",
  kind: "query",
  input: z.object({}),
  run: async () => {
    const state = await playerRow()
    const [item] = await db
      .select()
      .from(musicQueueItems)
      .where(eq(musicQueueItems.status, "playing"))
      .limit(1)
    const [current] = item ? await describeItems(db, [item]) : []
    return {
      current: current ?? null,
      paused: state?.paused ?? false,
      volume: state?.volume ?? 40,
      autoplay: state?.autoplay ?? true,
      positionS: state ? Math.round(positionNow(state) * 10) / 10 : 0,
      state: state?.state ?? "idle",
      error: state?.error ?? null,
      online: Boolean(
        state?.seenAt && Date.now() - state.seenAt.getTime() < ONLINE_MS
      ),
    }
  },
})

export const listQueue = defineAction({
  name: "list_queue",
  title: "播放佇列",
  description:
    "Songs waiting to play, in order, each with who added it and how (queue, next, cut_in). The playing song is not included; see now_playing.",
  kind: "query",
  input: z.object({}),
  run: async () => ({ items: await describeItems(db, await queuedItems()) }),
})

export const listActivity = defineAction({
  name: "list_activity",
  title: "誰做了什麼",
  description:
    "Recent actions, newest first: who added, cut in, skipped, removed, paused, resumed or changed the volume (a member's clicks within a minute show as the level they ended on), with the song title and, for playlists, how many songs.",
  kind: "query",
  input: z.object({ limit: z.number().int().min(1).max(100).default(30) }),
  run: async (_actor, { limit }) => ({
    activities: await recentActivities(limit),
  }),
})

export const searchMusic = defineAction({
  name: "search_music",
  title: "搜尋歌曲",
  description:
    "Search YouTube Music for songs, or resolve a pasted link: YouTube / YouTube Music, a Bilibili video (bilibili.com, b23.tv) or a live Twitch channel (twitch.tv). A song link returns that song; a playlist link returns the playlist (id, title, song count) and its first songs. Add results with add_song or add_playlist.",
  kind: "query",
  input: z.object({
    query: z.string().trim().min(1, "輸入歌名或連結").max(300),
  }),
  run: async (_actor, { query }) => {
    const other = twitch.parseLink(query) ?? (await bilibili.parseLink(query))
    if (other) return { tracks: [await trackOf(other)], playlist: null }
    const link = parseLink(query)
    if (link?.kind === "video")
      return { tracks: [await getTrack(link.videoId)], playlist: null }
    if (link?.kind === "playlist") {
      const list = await getPlaylist(link.playlistId)
      return {
        tracks: list.tracks.slice(0, 20),
        playlist: {
          id: link.playlistId,
          title: list.title,
          count: list.tracks.length,
        },
      }
    }
    return { tracks: await searchSongs(query), playlist: null }
  },
})

export const addSong = defineAction({
  name: "add_song",
  title: "點歌",
  description:
    "Queue a song by id: a YouTube video id, bilibili:<bvid> (bilibili:<bvid>_p<n> for part n) or twitch:<channel> for a channel that is live now; search_music turns a link into one. as=queue adds it at the end, as=next plays it after the current song, as=cut_in plays it now and puts the current song back at the front to resume later. Waiting recommendations (added_as auto) give way and are taken out. A song already in the queue is not added twice: queue leaves it where it is, next moves it to the front, cut_in plays it now.",
  kind: "mutation",
  input: z.object({
    videoId,
    as: z.enum(["queue", "next", "cut_in"]).default("queue"),
  }),
  run: async (actor, input) => {
    const track = await trackOf(input.videoId)
    return withQueue(async (tx) => {
      await dropRecommendations(tx)
      await saveTracks(tx, [track])
      const keys = await sortKeys(tx)
      const existing = await liveItemOf(tx, input.videoId)
      if (existing) {
        if (input.as === "queue") return { itemId: existing.id, already: true }
        if (existing.status === "queued") {
          await tx
            .update(musicQueueItems)
            .set({ sort: keys.front })
            .where(eq(musicQueueItems.id, existing.id))
          if (input.as === "cut_in") await cutIn(tx, existing.id)
        }
        await logActivity(tx, {
          userId: actor.userId,
          kind: input.as,
          itemId: existing.id,
        })
        return { itemId: existing.id, already: true }
      }
      const [item] = await tx
        .insert(musicQueueItems)
        .values({
          videoId: input.videoId,
          sort: input.as === "queue" ? keys.end : keys.front,
          addedBy: actor.userId,
          addedAs: input.as,
        })
        .returning({ id: musicQueueItems.id })
      if (input.as === "cut_in") await cutIn(tx, item.id)
      await logActivity(tx, {
        userId: actor.userId,
        kind: input.as === "queue" ? "add" : input.as,
        itemId: item.id,
      })
      return { itemId: item.id, already: false }
    })
  },
})

// Plays the item now: the current song goes back to the front of the queue
// and will resume where it was.
async function cutIn(tx: Tx, id: string) {
  const playing = await currentItem(tx)
  if (playing?.id === id) return
  const state = await playerRow(tx)
  const { front } = await sortKeys(tx)
  if (playing)
    await tx
      .update(musicQueueItems)
      .set({
        status: "queued",
        sort: front,
        resumeAtS: state ? Math.max(0, positionNow(state) - 2) : 0,
      })
      .where(eq(musicQueueItems.id, playing.id))
  await tx
    .update(musicQueueItems)
    .set({ status: "playing", startedAt: new Date(), sort: front - 1 })
    .where(eq(musicQueueItems.id, id))
  await tx
    .update(musicPlayer)
    .set({
      positionS: 0,
      positionAt: null,
      state: "loading",
      error: null,
      paused: false,
    })
    .where(eq(musicPlayer.id, 1))
}

export const addPlaylist = defineAction({
  name: "add_playlist",
  title: "加入歌單",
  description: `Queue every song of a YouTube or YouTube Music playlist (link or id) at the end, at most ${PLAYLIST_LIMIT}. Songs already in the queue are skipped.`,
  kind: "mutation",
  input: z.object({ playlist: z.string().trim().min(1).max(300) }),
  run: async (actor, input) => {
    const link = parseLink(input.playlist)
    const playlistId =
      link?.kind === "playlist"
        ? link.playlistId
        : /^[\w-]{10,}$/.test(input.playlist)
          ? input.playlist
          : null
    if (!playlistId) throw new Error("不是 YouTube 歌單連結")
    const list = await getPlaylist(playlistId)
    if (!list.tracks.length) throw new Error("這個歌單是空的或看不到")
    return withQueue(async (tx) => {
      await dropRecommendations(tx)
      await saveTracks(tx, list.tracks)
      let { end } = await sortKeys(tx)
      let added = 0
      for (const track of list.tracks) {
        if (await liveItemOf(tx, track.videoId)) continue
        await tx.insert(musicQueueItems).values({
          videoId: track.videoId,
          sort: end++,
          addedBy: actor.userId,
          playlistId,
        })
        added++
      }
      await logActivity(tx, {
        userId: actor.userId,
        kind: "playlist",
        detail: { count: added, title: list.title },
      })
      return { added, total: list.tracks.length, title: list.title }
    })
  },
})

export const playNext = defineAction({
  name: "play_next",
  title: "下一首播",
  description:
    "Move a waiting song (by queue item id) to the front, so it plays right after the current one.",
  kind: "mutation",
  input: z.object({ itemId }),
  run: async (actor, { itemId: id }) =>
    withQueue(async (tx) => {
      const { front } = await sortKeys(tx)
      const moved = await tx
        .update(musicQueueItems)
        .set({ sort: front })
        .where(
          and(eq(musicQueueItems.id, id), eq(musicQueueItems.status, "queued"))
        )
        .returning({ id: musicQueueItems.id })
      if (!moved.length) throw new Error("這首已經不在佇列裡")
      await logActivity(tx, { userId: actor.userId, kind: "next", itemId: id })
      return { ok: true }
    }),
})

export const skipSong = defineAction({
  name: "skip_song",
  title: "跳過",
  description:
    "Skip the playing song; the next waiting song starts. Pass the playing item's id so a late click cannot skip the song after it.",
  kind: "mutation",
  input: z.object({ itemId }),
  run: async (actor, { itemId: id }) =>
    withQueue(async (tx) => {
      const skipped = await tx
        .update(musicQueueItems)
        .set({ status: "skipped", endedAt: new Date(), endedBy: actor.userId })
        .where(
          and(eq(musicQueueItems.id, id), eq(musicQueueItems.status, "playing"))
        )
        .returning({ id: musicQueueItems.id })
      if (!skipped.length) throw new Error("這首已經播完了")
      await logActivity(tx, { userId: actor.userId, kind: "skip", itemId: id })
      return { ok: true }
    }),
})

export const removeSong = defineAction({
  name: "remove_song",
  title: "移出佇列",
  description: "Take a waiting song (by queue item id) out of the queue.",
  kind: "mutation",
  input: z.object({ itemId }),
  run: async (actor, { itemId: id }) =>
    withQueue(async (tx) => {
      const removed = await tx
        .update(musicQueueItems)
        .set({ status: "removed", endedAt: new Date(), endedBy: actor.userId })
        .where(
          and(eq(musicQueueItems.id, id), eq(musicQueueItems.status, "queued"))
        )
        .returning({ id: musicQueueItems.id })
      if (!removed.length) throw new Error("這首已經不在佇列裡")
      await logActivity(tx, {
        userId: actor.userId,
        kind: "remove",
        itemId: id,
      })
      return { ok: true }
    }),
})

export const setPaused = defineAction({
  name: "set_paused",
  title: "暫停或繼續",
  description:
    "Pause (paused=true) or resume (paused=false) the music on the lab HomePod. Resuming continues the song where it stopped.",
  kind: "mutation",
  input: z.object({ paused: z.boolean() }),
  run: async (actor, { paused }) =>
    withQueue(async (tx) => {
      const state = await playerRow(tx)
      if (state?.paused === paused) return { paused }
      const playing = await currentItem(tx)
      if (paused && playing && state)
        await tx
          .update(musicQueueItems)
          .set({ resumeAtS: positionNow(state) })
          .where(eq(musicQueueItems.id, playing.id))
      await tx
        .update(musicPlayer)
        .set({ paused, error: null })
        .where(eq(musicPlayer.id, 1))
      await logActivity(tx, {
        userId: actor.userId,
        kind: paused ? "pause" : "resume",
        itemId: playing?.id,
      })
      return { paused }
    }),
})

export const setVolume = defineAction({
  name: "set_volume",
  title: "調音量",
  description: "Set the lab HomePod's volume for the music, 0 to 100.",
  kind: "mutation",
  input: z.object({ volume: z.number().int().min(0).max(100) }),
  run: async (actor, { volume }) =>
    withQueue(async (tx) => {
      await tx.update(musicPlayer).set({ volume }).where(eq(musicPlayer.id, 1))
      await logActivity(tx, {
        userId: actor.userId,
        kind: "volume",
        detail: { volume },
      })
      return { volume }
    }),
})

export const listPlayed = defineAction({
  name: "list_played",
  title: "播過的歌",
  description:
    "Songs that finished, were skipped or removed, newest first, with who added and who skipped or removed them.",
  kind: "query",
  input: z.object({ limit: z.number().int().min(1).max(100).default(30) }),
  run: async (_actor, { limit }) => {
    const items = await db
      .select()
      .from(musicQueueItems)
      .where(isNotNull(musicQueueItems.endedAt))
      .orderBy(desc(musicQueueItems.endedAt))
      .limit(limit)
    return { items: await describeItems(db, items) }
  },
})

/** A song LRCLIB did not have is asked again after this long. */
const LYRICS_RETRY_MS = 7 * 24 * 3600_000

export const getLyrics = defineAction({
  name: "get_lyrics",
  title: "歌詞",
  description:
    "Lyrics of a queued or played song to follow along (the page and the WinLab Mac app show them): timed lines (start second and text) when LRCLIB has them, else plain lines, else none.",
  kind: "query",
  input: z.object({ videoId }),
  run: async (_actor, { videoId }) => {
    const [track] = await db
      .select()
      .from(musicTracks)
      .where(eq(musicTracks.videoId, videoId))
      .limit(1)
    if (!track) throw new Error("找不到這首")
    let [row] = await db
      .select()
      .from(musicLyrics)
      .where(eq(musicLyrics.videoId, videoId))
      .limit(1)
    const stale =
      row &&
      !row.synced &&
      !row.plain &&
      Date.now() - row.fetchedAt.getTime() > LYRICS_RETRY_MS
    if (!row || stale) {
      const found = await findLyrics(track.title, track.artist, track.durationS)
      ;[row] = await db
        .insert(musicLyrics)
        .values({ videoId, ...found })
        .onConflictDoUpdate({
          target: musicLyrics.videoId,
          set: { ...found, fetchedAt: new Date() },
        })
        .returning()
    }
    if (row.synced) return { timed: true, lines: parseLrc(row.synced) }
    return {
      timed: false,
      lines: (row.plain ?? "")
        .split(/\r?\n/)
        .map((text) => ({ atS: null, text: text.trim() })),
    }
  },
})

export const setAutoplay = defineAction({
  name: "set_autoplay",
  title: "自動推薦",
  description:
    "Turn autoplay on or off for everyone. On, when nothing waits in the queue, music adds a song YouTube Music recommends after one a member picked recently (added_as auto). Skipping it works like any song.",
  kind: "mutation",
  input: z.object({ on: z.boolean() }),
  run: async (actor, { on }) =>
    withQueue(async (tx) => {
      await tx
        .update(musicPlayer)
        .set({ autoplay: on })
        .where(eq(musicPlayer.id, 1))
      if (!on) await dropRecommendations(tx)
      await logActivity(tx, {
        userId: actor.userId,
        kind: "autoplay",
        detail: { on },
      })
      return { autoplay: on }
    }),
})
