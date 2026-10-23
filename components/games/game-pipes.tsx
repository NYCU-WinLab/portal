"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { GameResult } from "@/lib/games/types"
import {
  BOTTOM,
  LEFT,
  PIPES_GRID,
  PIPES_LEVEL_COUNT,
  RIGHT,
  TOP,
  getConnected,
  getEndpoints,
  getPuzzle,
  rotateCW,
} from "@/lib/games/pipes-puzzle"

function PipeSVG({
  mask,
  isSource,
  connected,
}: {
  mask: number
  isSource: boolean
  connected: boolean
}) {
  const color = connected ? "stroke-primary" : "stroke-muted-foreground"
  const sw = 7
  const numConn = [TOP, RIGHT, BOTTOM, LEFT].filter((b) => mask & b).length
  const isEndpoint = numConn === 1

  // Endpoint dot sits on the closed end of the pipe (opposite the open side).
  let ex = 20,
    ey = 20
  if (isEndpoint) {
    if (mask & TOP) ey = 36
    else if (mask & RIGHT) ex = 4
    else if (mask & BOTTOM) ey = 4
    else ex = 36
  }

  return (
    <svg viewBox="0 0 40 40" className="h-full w-full">
      {!!(mask & TOP) && (
        <line
          x1="20"
          y1="20"
          x2="20"
          y2="0"
          className={color}
          strokeWidth={sw}
          strokeLinecap="round"
        />
      )}
      {!!(mask & RIGHT) && (
        <line
          x1="20"
          y1="20"
          x2="40"
          y2="20"
          className={color}
          strokeWidth={sw}
          strokeLinecap="round"
        />
      )}
      {!!(mask & BOTTOM) && (
        <line
          x1="20"
          y1="20"
          x2="20"
          y2="40"
          className={color}
          strokeWidth={sw}
          strokeLinecap="round"
        />
      )}
      {!!(mask & LEFT) && (
        <line
          x1="20"
          y1="20"
          x2="0"
          y2="20"
          className={color}
          strokeWidth={sw}
          strokeLinecap="round"
        />
      )}
      {isSource ? (
        <circle
          cx="20"
          cy="20"
          r="7"
          className="fill-primary stroke-background"
          strokeWidth="2"
        />
      ) : isEndpoint ? (
        <circle
          cx={ex}
          cy={ey}
          r="5"
          className={`${connected ? "fill-success" : "fill-muted"} ${color}`}
          strokeWidth="2"
        />
      ) : null}
    </svg>
  )
}

interface GamePipesProps {
  onComplete: (result: GameResult) => void
  onLevelChange?: (level: number | null) => void
}

export function GamePipes({ onComplete, onLevelChange }: GamePipesProps) {
  const [level, setLevel] = useState(1)
  const [current, setCurrent] = useState<number[][]>([])
  const [gameState, setGameState] = useState<"idle" | "playing" | "won">("idle")
  const startRef = useRef<number | null>(null)
  const completedRef = useRef(false)

  // Solved/source/scrambled all come from the deterministic level number.
  const puzzle = useMemo(() => getPuzzle(level), [level])

  const start = useCallback(
    (lvl: number) => {
      const p = getPuzzle(lvl)
      completedRef.current = false
      setLevel(p.level)
      onLevelChange?.(p.level)
      setCurrent(p.scrambled.map((row) => [...row]))
      setGameState("playing")
      startRef.current = Date.now()
    },
    [onLevelChange]
  )

  const connected = useMemo(() => {
    if (!current.length) return new Set<string>()
    return getConnected(current, puzzle.source, PIPES_GRID, PIPES_GRID)
  }, [current, puzzle.source])

  const endpoints = useMemo(
    () => getEndpoints(puzzle.solved, puzzle.source),
    [puzzle]
  )

  const isWon = useMemo(
    () =>
      gameState === "playing" &&
      endpoints.length > 0 &&
      endpoints.every(([r, c]) => connected.has(`${r},${c}`)),
    [endpoints, connected, gameState]
  )

  useEffect(() => {
    if (isWon && !completedRef.current) {
      completedRef.current = true
      const ms = Date.now() - (startRef.current ?? Date.now())
      setGameState("won")
      setTimeout(
        () => onComplete({ score: endpoints.length, finishTimeMs: ms }),
        300
      )
    }
  }, [isWon, endpoints, onComplete])

  const handleClick = useCallback(
    (r: number, c: number) => {
      if (
        gameState !== "playing" ||
        (r === puzzle.source[0] && c === puzzle.source[1])
      )
        return
      setCurrent((prev) => {
        const next = prev.map((row) => [...row])
        next[r]![c] = rotateCW(next[r]![c]!)
        return next
      })
    },
    [gameState, puzzle.source]
  )

  const goToLevel = (lvl: number) => {
    const clamped = Math.max(1, Math.min(PIPES_LEVEL_COUNT, lvl))
    start(clamped)
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex w-full max-w-xs items-center justify-between">
        <p className="text-body text-muted-foreground">
          {gameState === "playing" || gameState === "won"
            ? `關卡 ${level}，連接 ${endpoints.filter(([r, c]) => connected.has(`${r},${c}`)).length} / ${endpoints.length}`
            : "點擊管道旋轉，讓所有端點（圓點）連通"}
        </p>
        <Button variant="outline" onClick={() => start(level)}>
          {gameState === "idle" ? "開始遊戲" : "重新開始"}
        </Button>
      </div>

      {gameState === "idle" ? (
        <p className="py-8 text-center text-body text-muted-foreground">
          按下開始，旋轉管道讓水從藍色源頭流到所有端點。共 {PIPES_LEVEL_COUNT}{" "}
          關。
        </p>
      ) : (
        <>
          <div className="grid grid-cols-6 gap-0.5 rounded-control border bg-muted/20 p-2">
            {current.map((row, r) =>
              row.map((mask, c) => {
                const isSrc = r === puzzle.source[0] && c === puzzle.source[1]
                const isConn = connected.has(`${r},${c}`)
                return (
                  <button
                    key={`${r},${c}`}
                    onClick={() => handleClick(r, c)}
                    disabled={isSrc || gameState !== "playing"}
                    aria-label={
                      isSrc
                        ? "水源"
                        : `第 ${r + 1} 行第 ${c + 1} 列管道，點擊旋轉`
                    }
                    className={`rounded-control transition-colors ${
                      isConn ? "bg-primary/10" : "bg-muted/40 hover:bg-muted"
                    } size-12.5 disabled:cursor-default`}
                  >
                    <PipeSVG mask={mask} isSource={isSrc} connected={isConn} />
                  </button>
                )
              })
            )}
          </div>

          <div className="flex items-center gap-2 text-body">
            <Button
              variant="outline"
              onClick={() => goToLevel(level - 1)}
              disabled={level <= 1}
              aria-label="上一關"
            >
              ←
            </Button>
            <span className="min-w-20 text-center text-muted-foreground tabular-nums">
              {level} / {PIPES_LEVEL_COUNT}
            </span>
            <Button
              variant="outline"
              onClick={() => goToLevel(level + 1)}
              disabled={level >= PIPES_LEVEL_COUNT}
              aria-label="下一關"
            >
              →
            </Button>
          </div>
        </>
      )}

      {gameState === "won" && (
        <p className="font-medium text-success">🎉 水管全部連通！</p>
      )}
    </div>
  )
}
