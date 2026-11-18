"use client"

import * as React from "react"

import { Switch } from "@/components/ui/switch"
import type { listQueue, nowPlaying } from "@/lib/actions/music"
import { cn } from "@/lib/utils"

type Playing = Awaited<ReturnType<typeof nowPlaying.run>>
type Item = Awaited<ReturnType<typeof listQueue.run>>["items"][number]

// Listening in the browser: the page plays the same songs as the lab, from
// the same queue, in an <audio> of its own. Only which song is current is
// followed: a song starts where the lab is, then plays on without waiting for
// the lab (the lab stops for a door greeting, the page does not), and a
// change of song, a skip or a cut-in, is followed at once. A song that ends
// first waits, silent, for the lab to move on.

// The songs held in this browser: the playing one and the next two, each
// fetched whole, so a bad connection later does not interrupt a song.
type Entry =
  | "loading"
  | { state: "ready"; url: string }
  | { state: "error"; message: string }
const files = new Map<string, Entry>()
const fileListeners = new Set<() => void>()
const changedFiles = () => fileListeners.forEach((listener) => listener())

function subscribeFiles(listener: () => void) {
  fileListeners.add(listener)
  return () => {
    fileListeners.delete(listener)
  }
}

async function download(id: string) {
  let entry: Entry
  try {
    const response = await fetch(
      `/api/music/audio?id=${encodeURIComponent(id)}`
    )
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string
      } | null
      throw new Error(body?.error ?? `伺服器回應 ${response.status}`)
    }
    entry = { state: "ready", url: URL.createObjectURL(await response.blob()) }
  } catch (error) {
    entry = {
      state: "error",
      message:
        error instanceof TypeError
          ? "網路不穩，音檔沒載到"
          : error instanceof Error
            ? error.message
            : "取不到音檔",
    }
  }
  // Dropped while it came: nobody wants it any more.
  if (files.get(id) !== "loading") {
    if (typeof entry === "object" && entry.state === "ready")
      URL.revokeObjectURL(entry.url)
    return
  }
  files.set(id, entry)
  changedFiles()
}

/** Holds exactly these songs: fetches the new ones (and again one that
 * failed), lets go of the others. */
function wantFiles(ids: string[]) {
  let changed = false
  for (const [id, entry] of files) {
    if (ids.includes(id)) continue
    if (typeof entry === "object" && entry.state === "ready")
      URL.revokeObjectURL(entry.url)
    files.delete(id)
    changed = true
  }
  for (const id of ids) {
    const entry = files.get(id)
    if (
      entry !== undefined &&
      !(typeof entry === "object" && entry.state === "error")
    )
      continue
    changed ||= entry !== undefined
    files.set(id, "loading")
    void download(id)
  }
  if (changed) changedFiles()
}

function useFile(id: string | null) {
  return React.useSyncExternalStore(
    subscribeFiles,
    () => (id ? files.get(id) : undefined),
    () => undefined
  )
}

// An empty sound, played on the member's click: a browser lets a page make
// sound only after one, and the songs start later, when their files arrive.
const SILENCE =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="

export function LocalListening({
  playing,
  upcoming,
}: {
  playing: Playing
  upcoming: Item[]
}) {
  const { current, paused } = playing
  // Off on every visit: a member turns it on each time they want to listen,
  // and the click is also what lets the browser make sound.
  const [on, setOn] = React.useState(false)
  // The browser would not let a song start without a click.
  const [blocked, setBlocked] = React.useState(false)
  const audio = React.useRef<HTMLAudioElement | null>(null)
  // The queue item whose song is in the element now.
  const loaded = React.useRef<string | null>(null)
  // Where the lab was when the page last heard, to start a song from.
  const lab = React.useRef({ positionS: 0, running: false, at: 0 })

  const itemId = current?.id ?? null
  const live = !!current && !current.track.durationS
  const videoId = current && !live ? current.track.videoId : null
  const file = useFile(on ? videoId : null)
  const url =
    typeof file === "object" && file.state === "ready" ? file.url : null

  const wanted = on
    ? [
        ...new Set(
          [
            videoId,
            ...upcoming
              .slice(0, 2)
              .map((item) =>
                item.track.durationS ? item.track.videoId : null
              ),
          ].filter((id): id is string => !!id)
        ),
      ].join("\n")
    : ""
  React.useEffect(() => {
    wantFiles(wanted ? wanted.split("\n") : [])
  }, [wanted])

  React.useEffect(() => {
    const element = new Audio()
    audio.current = element
    return () => {
      element.pause()
      element.removeAttribute("src")
      element.load()
      audio.current = null
      loaded.current = null
      wantFiles([])
    }
  }, [])

  const running = playing.state === "playing" && !paused
  React.useEffect(() => {
    lab.current = { positionS: playing.positionS, running, at: Date.now() }
  }, [playing.positionS, running, itemId])

  React.useEffect(() => {
    const element = audio.current
    if (!element) return
    if (!on || !url || !itemId) {
      element.pause()
      if (loaded.current !== null) {
        loaded.current = null
        element.removeAttribute("src")
        element.load()
      }
      return
    }
    if (loaded.current !== itemId) {
      loaded.current = itemId
      const { positionS, running, at } = lab.current
      const start = positionS + (running ? (Date.now() - at) / 1000 : 0)
      element.src = url
      element.addEventListener(
        "loadedmetadata",
        () => {
          element.currentTime = Math.min(start, element.duration)
        },
        { once: true }
      )
    }
    if (paused) {
      element.pause()
      return
    }
    element
      .play()
      .then(() => setBlocked(false))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "NotAllowedError")
          setBlocked(true)
      })
  }, [on, url, itemId, paused])

  const note = !on
    ? null
    : blocked
      ? "播放被擋住了，關掉再打開試試"
      : !current || live
        ? null
        : file === undefined || file === "loading"
          ? "載入音檔中…"
          : file.state === "error"
            ? file.message
            : null

  return (
    <>
      {/* A live stream has no file, so the switch waits, with its choice
          kept: the next song listens again if it was on. */}
      <label
        className={cn("flex items-center gap-2", live && "cursor-not-allowed")}
      >
        <Switch
          checked={on}
          disabled={live}
          onCheckedChange={(next) => {
            if (next && audio.current) {
              audio.current.src = SILENCE
              void audio.current.play().catch(() => {})
            }
            setBlocked(false)
            setOn(next)
          }}
        />
        <span className={cn(live && "opacity-50")}>
          {live ? "直播暫不支援在本機收聽" : "在本機收聽"}
        </span>
      </label>
      {/* The line stays while listening, so a note coming and going does
          not move what is below. */}
      {on && (
        <span role="status" className="basis-full text-muted-foreground">
          {note ?? "\u00a0"}
        </span>
      )}
    </>
  )
}
