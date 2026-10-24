"use client"

import {
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SkipForwardIcon,
} from "lucide-react"
import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { nowPlaying } from "@/lib/actions/music"

import { autoplay, pause, skip, volume } from "./actions"
import { ok } from "./ok"
import { addedLine, Cover, duration } from "./song"

type Playing = Awaited<ReturnType<typeof nowPlaying.run>>

const stateLabel = {
  idle: null,
  loading: "載入中",
  playing: null,
  waiting: "門口播報中，等等接著播",
  error: "播放失敗",
} as const

// The song on the HomePod: who added it, how far it is, and the controls
// everyone shares. The bar moves on its own between reports.
export function NowPlaying({ playing }: { playing: Playing }) {
  const { current } = playing

  const note = !playing.online
    ? "播放器離線"
    : playing.paused
      ? (playing.error ?? "已暫停")
      : current
        ? (playing.error ?? stateLabel[playing.state])
        : null

  return (
    <section aria-label="正在播放" className="flex flex-col gap-6">
      {/* Every part keeps its place whether a song plays or not, so the
          controls never move under a finger. */}
      <div className="flex items-center gap-6">
        <Cover src={current?.track.thumbnail ?? null} className="size-24" />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-title font-medium">
            {current?.track.title ?? "還沒有歌，點一首吧"}
          </h1>
          <p className="truncate text-muted-foreground">
            {current?.track.artist || "\u00a0"}
          </p>
          <p className="flex h-6 items-center gap-2 truncate text-muted-foreground">
            {current?.addedAs === "cut_in" && <Badge>插播</Badge>}
            {current && <span className="truncate">{addedLine(current)}</span>}
          </p>
        </div>
      </div>

      <Elapsed
        key={`${current?.id}:${playing.positionS}:${playing.state}:${playing.paused}`}
        positionS={current ? playing.positionS : 0}
        running={!!current && playing.state === "playing" && !playing.paused}
        total={current?.track.durationS ?? null}
        live={!!current && !current.track.durationS}
        note={note}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!current}
          onClick={async () => ok(await pause({ paused: !playing.paused }))}
        >
          {playing.paused ? <PlayIcon /> : <PauseIcon />}
          {playing.paused ? "繼續" : "暫停"}
        </Button>
        <Button
          variant="outline"
          disabled={!current}
          onClick={async () =>
            current && ok(await skip({ itemId: current.id }))
          }
        >
          <SkipForwardIcon />
          跳過
        </Button>
        <Volume key={playing.volume} initial={playing.volume} />
        <label className="flex items-center gap-2">
          <Switch
            checked={playing.autoplay}
            onCheckedChange={async (on) => ok(await autoplay({ on }))}
          />
          自動推薦
        </label>
      </div>
    </section>
  )
}

// The bar and the times, with the player's state between them. Keyed by
// the server's figure, so each refresh starts it again from there; between
// refreshes it counts on its own while the HomePod plays. A live stream has
// no end: the bar stays full and 直播 takes the place of the length.
function Elapsed({
  positionS,
  running,
  total,
  live,
  note,
}: {
  positionS: number
  running: boolean
  total: number | null
  live: boolean
  note: string | null
}) {
  const [from] = React.useState(() => Date.now())
  const [now, setNow] = React.useState(from)
  React.useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])
  const position = running
    ? positionS + Math.max(0, (now - from) / 1000)
    : positionS
  return (
    <div className="flex flex-col gap-2">
      <Progress
        aria-label="播放進度"
        value={live ? 100 : total ? Math.min(100, (position / total) * 100) : 0}
      />
      <div className="grid grid-cols-3 text-muted-foreground tabular-nums">
        <span>{total || live ? duration(position) : "\u00a0"}</span>
        <span className="truncate text-center">{note}</span>
        <span className="text-right">{live ? "直播" : duration(total)}</span>
      </div>
    </div>
  )
}

// Volume moves at once on the page and is sent after a pause in clicks.
// Keyed by the server's level, so another member's change shows here.
function Volume({ initial }: { initial: number }) {
  const [level, setLevel] = React.useState(initial)
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  // Clicks faster than a render each count: they step from the last level
  // asked for, not the one on screen.
  const latest = React.useRef(initial)
  const change = (delta: number) => {
    const next = Math.min(100, Math.max(0, latest.current + delta))
    latest.current = next
    setLevel(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      ok(await volume({ volume: next }))
    }, 400)
  }
  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="小聲一點"
              onClick={() => change(-5)}
            />
          }
        >
          <MinusIcon />
        </TooltipTrigger>
        <TooltipContent>小聲一點</TooltipContent>
      </Tooltip>
      <span className="w-20 shrink-0 text-center tabular-nums">
        音量 {level}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="大聲一點"
              onClick={() => change(5)}
            />
          }
        >
          <PlusIcon />
        </TooltipTrigger>
        <TooltipContent>大聲一點</TooltipContent>
      </Tooltip>
    </div>
  )
}
