"use client"

import * as React from "react"

import { lyrics } from "./actions"

type Line = { atS: number | null; text: string }

// The playing song's lyrics. Timed lines follow the HomePod: the line being
// sung is bright and kept in the middle of the box. The player reports the
// position the room hears, so no offset is added here.
export function Lyrics({
  videoId,
  positionS,
  running,
}: {
  videoId: string | null
  positionS: number
  running: boolean
}) {
  const [loaded, setLoaded] = React.useState<{
    videoId: string
    timed: boolean
    lines: Line[]
  } | null>(null)
  const box = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!videoId) return
    let gone = false
    lyrics({ videoId }).then((result) => {
      if (!gone && result.data) setLoaded({ videoId, ...result.data })
    })
    return () => {
      gone = true
    }
  }, [videoId])

  if (!videoId) return null
  const ready = loaded?.videoId === videoId ? loaded : null
  return (
    <section aria-label="歌詞">
      <div
        ref={box}
        className="relative h-64 overflow-y-auto py-24 text-center"
      >
        {!ready ? (
          <p className="text-muted-foreground">歌詞載入中</p>
        ) : !ready.lines.length ? (
          <p className="text-muted-foreground">找不到歌詞</p>
        ) : !ready.timed ? (
          ready.lines.map((line, i) => (
            <p key={i} className="min-h-6">
              {line.text}
            </p>
          ))
        ) : (
          <TimedLines
            key={`${positionS}:${running}`}
            box={box}
            lines={ready.lines}
            positionS={positionS}
            running={running}
          />
        )}
      </div>
    </section>
  )
}

// Keyed by the server's figure, like the progress bar: each report starts
// the count again from there, and between reports it runs on its own.
function TimedLines({
  box,
  lines,
  positionS,
  running,
}: {
  box: React.RefObject<HTMLDivElement | null>
  lines: Line[]
  positionS: number
  running: boolean
}) {
  const [from] = React.useState(() => Date.now())
  const [now, setNow] = React.useState(from)
  React.useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [running])
  const position = running ? positionS + (now - from) / 1000 : positionS

  let active = -1
  for (let i = 0; i < lines.length && lines[i].atS! <= position; i++) active = i

  React.useEffect(() => {
    const el = box.current
    const line = el?.querySelector<HTMLElement>(`[data-line="${active}"]`)
    if (!el || !line) return
    el.scrollTo({
      top: line.offsetTop - el.clientHeight / 2 + line.clientHeight / 2,
      behavior: "smooth",
    })
  }, [box, active])

  return lines.map((line, i) => (
    <p
      key={i}
      data-line={i}
      className={
        i === active ? "min-h-6 font-medium" : "min-h-6 text-muted-foreground"
      }
    >
      {line.text}
    </p>
  ))
}
