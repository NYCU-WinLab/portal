// Reads YouTube and YouTube Music: song search, playlists and one video's
// details. Only metadata; the player on the lab network fetches the audio
// itself with yt-dlp. No credentials: everything here is public.
import { Innertube } from "youtubei.js"

export type Track = {
  videoId: string
  title: string
  artist: string
  durationS: number | null
  thumbnail: string | null
}

/** Most songs one playlist link adds. */
export const PLAYLIST_LIMIT = 200

let client: Promise<Innertube> | null = null
function youtube() {
  client ??= Innertube.create({
    retrieve_player: false,
    lang: "zh-TW",
    location: "TW",
  }).catch((error) => {
    client = null
    throw error
  })
  return client
}

/* eslint-disable @typescript-eslint/no-explicit-any -- youtubei.js node
   types vary by renderer; each reader below takes only plain fields. */
function names(list: any): string {
  return Array.isArray(list)
    ? list
        .map((a: any) => a?.name)
        .filter(Boolean)
        .join(", ")
    : ""
}

function musicItem(item: any): Track | null {
  if (!item?.id || typeof item.id !== "string") return null
  return {
    videoId: item.id,
    title: String(item.title ?? item.name ?? "").trim() || item.id,
    artist: names(item.artists) || names(item.authors) || "",
    durationS: item.duration?.seconds || null,
    thumbnail:
      item.thumbnail?.contents?.at(-1)?.url ??
      item.thumbnail?.contents?.[0]?.url ??
      null,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Songs on YouTube Music matching the query, best first. */
export async function searchSongs(query: string, limit = 12): Promise<Track[]> {
  const yt = await youtube()
  const result = await yt.music.search(query, { type: "song" })
  const shelf = result.contents?.[0] as { contents?: unknown[] } | undefined
  return (shelf?.contents ?? [])
    .map(musicItem)
    .filter((track): track is Track => track !== null)
    .slice(0, limit)
}

/** What YouTube Music would play after this song, in its order. */
export async function upNext(videoId: string): Promise<Track[]> {
  const yt = await youtube()
  const panel = await yt.music.getUpNext(videoId, true)
  return (panel.contents ?? [])
    .map((item) => {
      const x = item as unknown as {
        video_id?: string
        title?: string | { text?: string }
        artists?: { name?: string }[]
        author?: string
        duration?: { seconds?: number }
        thumbnail?: { url?: string }[]
      }
      if (!x.video_id || x.video_id === videoId) return null
      const title = typeof x.title === "string" ? x.title : x.title?.text
      return {
        videoId: x.video_id,
        title: title?.trim() || x.video_id,
        artist:
          x.artists
            ?.map((a) => a.name)
            .filter(Boolean)
            .join(", ") ||
          x.author ||
          "",
        durationS: x.duration?.seconds || null,
        thumbnail: x.thumbnail?.at(-1)?.url ?? null,
      }
    })
    .filter((track): track is Track => track !== null)
}

/** One video's details by id. */
export async function getTrack(videoId: string): Promise<Track> {
  const yt = await youtube()
  const info = await yt.getBasicInfo(videoId)
  const basic = info.basic_info
  return {
    videoId,
    title: basic.title ?? videoId,
    artist: (basic.author ?? "").replace(/ - Topic$/, ""),
    // A live stream (a radio channel) has no length: null.
    durationS: basic.is_live ? null : basic.duration || null,
    thumbnail: basic.thumbnail?.[0]?.url ?? null,
  }
}

/** A playlist's songs in order, at most PLAYLIST_LIMIT. */
export async function getPlaylist(
  playlistId: string
): Promise<{ title: string; tracks: Track[] }> {
  const yt = await youtube()
  let page = await yt.music.getPlaylist(playlistId)
  const header = page.header as { title?: { text?: string } } | undefined
  const tracks: Track[] = []
  for (;;) {
    for (const item of page.items ?? []) {
      const track = musicItem(item)
      if (track) tracks.push(track)
    }
    if (tracks.length >= PLAYLIST_LIMIT || !page.has_continuation) break
    page = await page.getContinuation()
  }
  return {
    title: header?.title?.text ?? "歌單",
    tracks: tracks.slice(0, PLAYLIST_LIMIT),
  }
}

/** What a pasted link points at: a playlist, a video, or neither. Accepts
 * youtube.com, music.youtube.com, m.youtube.com and youtu.be links. */
export function parseLink(
  text: string
):
  | { kind: "playlist"; playlistId: string; videoId?: string }
  | { kind: "video"; videoId: string }
  | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "")
  if (host !== "youtube.com" && host !== "youtu.be") return null
  const id = /^[\w-]{11}$/
  const videoId =
    host === "youtu.be"
      ? url.pathname.slice(1)
      : (url.searchParams.get("v") ??
        url.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/)?.[1])
  const playlistId = url.searchParams.get("list")
  // A watch link inside a radio mix (RD...) is one song, not the endless mix.
  if (
    playlistId &&
    /^[\w-]+$/.test(playlistId) &&
    !/^RD(?!CLAK)/.test(playlistId)
  )
    return {
      kind: "playlist",
      playlistId,
      ...(videoId && id.test(videoId) ? { videoId } : {}),
    }
  if (videoId && id.test(videoId)) return { kind: "video", videoId }
  return null
}
