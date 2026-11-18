// The songs members listen to in their own browsers. The audio files live on
// the player's machine on the lab network, which the portal cannot reach, so
// the player brings them: a browser asks for a song (fetchAudio), the song
// shows up in the player's state as `upload` (wantedIds), the player posts
// the file to /api/music/player/audio (receiveAudio), and the portal hands it
// on. Files wait in a small temp folder, so the next listener, or the next
// play of the same song, needs no second trip. It never touches the database.
import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { createWriteStream } from "node:fs"
import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as WebReadableStream } from "node:stream/web"

// An empty value, as a copied .env.example leaves it, counts as not set.
const DIR =
  process.env.MUSIC_AUDIO_DIR || path.join(tmpdir(), "winlab-music-audio")
/** Songs kept, newest use first; the rest go. */
const KEEP_FILES = 20
/** How long a browser waits for the player to bring a song. The player's own
 * download limit is 120 seconds, and the post comes after it. */
export const WAIT_MS = 150_000
const PART_MAX_AGE_MS = 10 * 60_000

/** What yt-dlp and Bilibili give: a file extension and its media type. */
export const AUDIO_TYPES: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  webm: "audio/webm",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
}

/** The media type of an extension, or null for one that is not audio. */
export function audioType(ext: string) {
  return Object.hasOwn(AUDIO_TYPES, ext) ? AUDIO_TYPES[ext] : null
}

/** The most one file may be. A song is a few MB; this only stops a runaway. */
function maxBytes() {
  return Number(process.env.MUSIC_AUDIO_MAX_BYTES) || 100 * 1024 * 1024
}

export type AudioFile = { path: string; type: string; size: number }

type Waiter = {
  done: Promise<AudioFile>
  resolve: (file: AudioFile) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

// Route handlers may be bundled apart, so the state hangs on globalThis: the
// route that takes a browser's request and the one that takes the player's
// post must see the same waiters.
const shared = globalThis as typeof globalThis & {
  __musicAudio?: { wanted: Map<string, Waiter>; events: EventEmitter }
}
const state = (shared.__musicAudio ??= {
  wanted: new Map<string, Waiter>(),
  events: new EventEmitter(),
})
state.events.setMaxListeners(0)

/** The file name stem of an id: a colon becomes an underscore, as in the
 * player's own cache. Anything else odd is refused, since it names a file. */
function nameOf(videoId: string) {
  const name = videoId.replace(":", "_")
  if (!/^[\w-]{1,80}$/.test(name)) throw new Error("不是音檔的 id")
  return name
}

/** The song's file, if the portal holds it. */
export async function cachedAudio(videoId: string): Promise<AudioFile | null> {
  const name = nameOf(videoId)
  const files = await readdir(DIR).catch(() => [] as string[])
  for (const file of files) {
    const dot = file.lastIndexOf(".")
    // A partial upload is name.<random>.part: its stem is not the name.
    if (dot < 0 || file.slice(0, dot) !== name) continue
    const type = audioType(file.slice(dot + 1))
    if (!type) continue
    const full = path.join(DIR, file)
    const info = await stat(full).catch(() => null)
    if (!info) continue
    // A use keeps the file young for the trim.
    const now = new Date()
    await utimes(full, now, now).catch(() => {})
    return { path: full, type, size: info.size }
  }
  return null
}

function until<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("已取消"))
    signal.addEventListener("abort", () => reject(new Error("已取消")), {
      once: true,
    })
    promise.then(resolve, reject)
  })
}

function open(videoId: string) {
  let resolve!: Waiter["resolve"]
  let reject!: Waiter["reject"]
  const done = new Promise<AudioFile>((res, rej) => {
    resolve = res
    reject = rej
  })
  // Nobody may be listening when it fails; that is not an unhandled error.
  done.catch(() => {})
  const timer = setTimeout(() => failAudio(videoId, "等不到音檔"), WAIT_MS)
  timer.unref?.()
  const waiter: Waiter = { done, resolve, reject, timer }
  state.wanted.set(videoId, waiter)
  state.events.emit("wanted")
  return waiter
}

function close(videoId: string, outcome: AudioFile | Error) {
  const waiter = state.wanted.get(videoId)
  if (!waiter) return
  clearTimeout(waiter.timer)
  state.wanted.delete(videoId)
  if (outcome instanceof Error) waiter.reject(outcome)
  else waiter.resolve(outcome)
  state.events.emit("wanted")
}

/** The song's file: at once when the portal holds it, else once the player
 * has posted it. Browsers asking for the same song wait for the same post. */
export async function fetchAudio(videoId: string, signal?: AbortSignal) {
  const hit = await cachedAudio(videoId)
  if (hit) return hit
  const waiter = state.wanted.get(videoId) ?? open(videoId)
  return until(waiter.done, signal)
}

/** Ends the wait for a song the player could not get. */
export function failAudio(videoId: string, error: string) {
  close(videoId, new Error(error.slice(0, 200) || "音檔取得失敗"))
}

/** Songs a browser waits for: the player's `upload` list. */
export function wantedIds() {
  return [...state.wanted.keys()]
}

/** Calls handler whenever the list of wanted songs changes. */
export function onWanted(handler: () => void) {
  state.events.on("wanted", handler)
  return () => {
    state.events.off("wanted", handler)
  }
}

/** Keeps the newest KEEP_FILES songs and drops stale partial uploads. */
async function trim() {
  const names = await readdir(DIR).catch(() => [] as string[])
  const files: { full: string; mtime: number; part: boolean }[] = []
  for (const file of names) {
    const full = path.join(DIR, file)
    const info = await stat(full).catch(() => null)
    if (info?.isFile())
      files.push({ full, mtime: info.mtimeMs, part: file.endsWith(".part") })
  }
  const now = Date.now()
  const stale = files.filter((f) => f.part && now - f.mtime > PART_MAX_AGE_MS)
  const songs = files
    .filter((f) => !f.part)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(KEEP_FILES)
  await Promise.all(
    [...stale, ...songs].map((f) => rm(f.full, { force: true }))
  )
}

/** Stores the file the player posted and answers everyone waiting for it. */
export async function receiveAudio(
  videoId: string,
  ext: string,
  body: ReadableStream<Uint8Array>
) {
  const name = nameOf(videoId)
  const type = audioType(ext)
  if (!type) throw new Error("不支援的音訊格式")
  await mkdir(DIR, { recursive: true })
  const final = path.join(DIR, `${name}.${ext}`)
  const part = path.join(DIR, `${name}.${randomUUID()}.part`)
  const limit = maxBytes()
  let size = 0
  try {
    await pipeline(
      Readable.fromWeb(body as unknown as WebReadableStream),
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          size += chunk.length
          if (size > limit) throw new Error("音檔太大")
          yield chunk
        }
      },
      createWriteStream(part)
    )
    if (size === 0) throw new Error("空的音檔")
    await rename(part, final)
  } catch (error) {
    await rm(part, { force: true })
    throw error
  }
  await trim()
  const file = { path: final, type, size }
  close(videoId, file)
  return file
}
