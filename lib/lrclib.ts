// Reads LRCLIB (lrclib.net), a free lyrics database with timed lines. Public,
// no credentials. Only the music actions call it; they cache what it says.

const BASE = "https://lrclib.net/api"
const headers = { "User-Agent": "winlab-portal (https://portal.winlab.tw)" }
const timeout = () => AbortSignal.timeout(8000)

export type Lyrics = { synced: string | null; plain: string | null }

type Song = {
  duration: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

/** YouTube Music titles carry romanized or translated names and mix labels
 * ("悪魔の子 - Akuma no Ko", "Automatic (2024 Mix)"); LRCLIB has the bare one. */
export function bareTitle(title: string) {
  return (
    title
      .split(" - ")[0]
      .replace(/\s*[(（[【].*?[)）\]】]/g, "")
      .trim() || title
  )
}

async function read<T>(path: string, query: Record<string, string>) {
  const response = await fetch(
    `${BASE}/${path}?${new URLSearchParams(query)}`,
    { headers, cache: "no-store", signal: timeout() }
  )
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`LRCLIB ${path} ${response.status}`)
  return (await response.json()) as T
}

/** The lyrics of one song, timed when LRCLIB has them. An exact match on
 * title, artist and length comes first; otherwise a search, keeping a result
 * within 5 seconds of the length so a live or extended cut is not timed
 * against the wrong recording. */
export async function findLyrics(
  title: string,
  artist: string,
  durationS: number | null
): Promise<Lyrics> {
  const name = bareTitle(title)
  const exact = durationS
    ? await read<Song>("get", {
        track_name: name,
        artist_name: artist,
        duration: String(durationS),
      })
    : null
  if (exact?.syncedLyrics)
    return { synced: exact.syncedLyrics, plain: exact.plainLyrics }

  const found = (await read<Song[]>("search", { q: `${name} ${artist}` })) ?? []
  const near = (r: Song) => !durationS || Math.abs(r.duration - durationS) <= 5
  const timed = found.find((r) => r.syncedLyrics && near(r))
  if (timed) return { synced: timed.syncedLyrics, plain: timed.plainLyrics }
  const text = exact ?? found.find((r) => r.plainLyrics && near(r))
  return { synced: null, plain: text?.plainLyrics ?? null }
}

/** Timed lines from LRC text: [mm:ss.xx] marks, several allowed per line.
 * Empty lines stay, as the gaps between verses. */
export function parseLrc(lrc: string): { atS: number; text: string }[] {
  const lines: { atS: number; text: string }[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const marks = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]
    if (!marks.length) continue
    const text = raw.replace(/\[[^\]]*\]/g, "").trim()
    for (const m of marks)
      lines.push({ atS: Number(m[1]) * 60 + Number(m[2]), text })
  }
  return lines.sort((a, b) => a.atS - b.atS)
}
