"use client"

import * as React from "react"

import { GAME_META, formatTime } from "@/lib/games/constants"
import type { GameType } from "@/lib/games/types"
import { cn } from "@/lib/utils"

import { loadLeaderboard } from "./actions"

type Row = Awaited<ReturnType<typeof loadLeaderboard>>["scores"][number]

export function Scoreboard({
  gameType,
  level,
  version,
}: {
  gameType: GameType
  level: number | null
  version: number
}) {
  const [loaded, setLoaded] = React.useState<{
    key: string
    rows: Row[]
  } | null>(null)
  const key = `${gameType}:${level}:${version}`
  React.useEffect(() => {
    let live = true
    void loadLeaderboard(gameType, level).then(({ scores }) => {
      if (live) setLoaded({ key, rows: scores })
    })
    return () => {
      live = false
    }
  }, [gameType, level, key])
  const rows = loaded?.key === key ? loaded.rows : null
  const meta = GAME_META[gameType]

  if (!rows) return <p className="text-muted-foreground">讀取中…</p>
  if (!rows.length) return <p className="text-muted-foreground">還沒有成績</p>
  return (
    <ol className="flex flex-col">
      {rows.map((row, i) => (
        <li
          key={row.userId}
          className="flex min-h-10 items-center gap-3 border-b border-border"
        >
          <span
            className={cn(
              "w-6 shrink-0 tabular-nums",
              i < 3 ? "font-medium text-primary" : "text-muted-foreground"
            )}
          >
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          <span className="shrink-0 tabular-nums">
            {meta.scoreLabel(row.score)}
          </span>
          <span className="w-16 shrink-0 text-right text-muted-foreground tabular-nums">
            {formatTime(row.finishTimeMs)}
          </span>
        </li>
      ))}
    </ol>
  )
}
