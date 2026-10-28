// Reads Twitch: whether a channel is live, and what it streams. Public, no
// credentials: the same GraphQL endpoint and client id the Twitch site uses.
// Only live channels play; the player streams them from the live edge.
import type { Track } from "@/lib/youtube"

const GQL = "https://gql.twitch.tv/gql"
const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"

/** A music id is `twitch:<channel login>`. */
const ID = /^twitch:([a-z0-9_]{1,25})$/
export const ID_PATTERN = ID.source

// Paths on twitch.tv that are not channels.
const RESERVED = new Set([
  "directory",
  "downloads",
  "jobs",
  "p",
  "search",
  "settings",
  "subscriptions",
  "turbo",
  "videos",
  "wallet",
])

/** The music id a Twitch channel link points at, or null. */
export function parseLink(text: string): string | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (!/(^|\.)twitch\.tv$/.test(url.hostname)) return null
  const login = url.pathname.split("/")[1]?.toLowerCase()
  if (!login || RESERVED.has(login) || !/^[a-z0-9_]{1,25}$/.test(login))
    return null
  return `twitch:${login}`
}

/** A live channel by music id; throws when it is offline. */
export async function getTrack(id: string): Promise<Track> {
  const login = id.match(ID)?.[1]
  if (!login) throw new Error("不是 Twitch 頻道")
  const response = await fetch(GQL, {
    method: "POST",
    headers: { "Client-ID": CLIENT_ID, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `query($login: String!) { user(login: $login) { displayName stream { title previewImageURL(width: 640, height: 360) } } }`,
      variables: { login },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`Twitch ${response.status}`)
  const { data } = (await response.json()) as {
    data?: {
      user: {
        displayName: string
        stream: { title: string; previewImageURL: string } | null
      } | null
    }
  }
  const user = data?.user
  if (!user) throw new Error("找不到這個 Twitch 頻道")
  if (!user.stream) throw new Error("這個頻道現在沒有直播")
  return {
    videoId: id,
    title: user.stream.title || user.displayName,
    artist: user.displayName,
    // Live: no length, so the player streams it instead of downloading.
    durationS: null,
    thumbnail: user.stream.previewImageURL,
  }
}
