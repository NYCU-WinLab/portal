"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { GameResult } from "@/lib/games/types"
import { QUEENS_LEVEL_COUNT, getQueensPuzzle } from "@/lib/games/queens-puzzles"

const REGION_COLORS = [
  "bg-primary/25",
  "bg-warning/35",
  "bg-success/30",
  "bg-destructive/25",
  "bg-primary/55",
  "bg-muted-foreground/35",
  "bg-success/60",
]

// 0 = empty, 1 = mark (✕ "not a queen" hint), 2 = queen
type CellState = 0 | 1 | 2

const gridCols: Record<number, string> = {
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
}
type Placement = CellState[][]

function isQueen(p: Placement, r: number, c: number): boolean {
  return p[r]?.[c] === 2
}

function checkAdjacent(
  placement: Placement,
  r: number,
  c: number,
  size: number
): boolean {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue
      const nr = r + dr,
        nc = c + dc
      if (
        nr >= 0 &&
        nr < size &&
        nc >= 0 &&
        nc < size &&
        isQueen(placement, nr, nc)
      )
        return true
    }
  }
  return false
}

function computeViolations(
  placement: Placement,
  regions: number[][],
  size: number
): Set<string> {
  const set = new Set<string>()
  if (!placement.length) return set

  const byRow = new Map<number, string[]>()
  const byCol = new Map<number, string[]>()
  const byRegion = new Map<number, string[]>()

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isQueen(placement, r, c)) continue
      const key = `${r},${c}`
      const region = regions[r]![c]!
      if (!byRow.has(r)) byRow.set(r, [])
      byRow.get(r)!.push(key)
      if (!byCol.has(c)) byCol.set(c, [])
      byCol.get(c)!.push(key)
      if (!byRegion.has(region)) byRegion.set(region, [])
      byRegion.get(region)!.push(key)

      if (checkAdjacent(placement, r, c, size)) set.add(key)
    }
  }

  for (const group of [byRow, byCol, byRegion]) {
    for (const keys of group.values()) {
      if (keys.length > 1) for (const k of keys) set.add(k)
    }
  }
  return set
}

function isComplete(
  placement: Placement,
  regions: number[][],
  size: number
): boolean {
  const numRegions = new Set(regions.flat()).size
  if (computeViolations(placement, regions, size).size > 0) return false

  let total = 0
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isQueen(placement, r, c)) total++
    }
  }
  return total === numRegions
}

interface GameQueensProps {
  onComplete: (result: GameResult) => void
  onLevelChange?: (level: number | null) => void
}

export function GameQueens({ onComplete, onLevelChange }: GameQueensProps) {
  const [level, setLevel] = useState(1)
  const [placement, setPlacement] = useState<Placement>([])
  const [gameState, setGameState] = useState<"idle" | "playing" | "won">("idle")
  const startRef = useRef<number | null>(null)
  const completedRef = useRef(false)

  const puzzle = useMemo(() => getQueensPuzzle(level), [level])

  const start = useCallback(
    (lvl: number) => {
      const p = getQueensPuzzle(lvl)
      completedRef.current = false
      setLevel(p.level)
      onLevelChange?.(p.level)
      setPlacement(
        Array.from(
          { length: p.size },
          () => Array<CellState>(p.size).fill(0) as CellState[]
        )
      )
      setGameState("playing")
      startRef.current = Date.now()
    },
    [onLevelChange]
  )

  const handleCellClick = useCallback(
    (r: number, c: number) => {
      if (gameState !== "playing") return
      setPlacement((prev) => {
        const next = prev.map((row) => [...row]) as Placement
        const cur = next[r]![c] ?? 0
        next[r]![c] = ((cur + 1) % 3) as CellState
        return next
      })
    },
    [gameState]
  )

  const violations = useMemo(
    () => computeViolations(placement, puzzle.regions, puzzle.size),
    [placement, puzzle]
  )

  const won = useMemo(
    () =>
      gameState === "playing" &&
      placement.length > 0 &&
      isComplete(placement, puzzle.regions, puzzle.size),
    [placement, puzzle, gameState]
  )

  useEffect(() => {
    if (won && !completedRef.current) {
      completedRef.current = true
      const ms = Date.now() - startRef.current!
      setGameState("won")
      setTimeout(
        () => onComplete({ score: puzzle.size, finishTimeMs: ms }),
        300
      )
    }
  }, [won, puzzle.size, onComplete])

  const queenCount = placement.flat().filter((v) => v === 2).length
  const numRegions = new Set(puzzle.regions.flat()).size

  const goToLevel = (lvl: number) => {
    const clamped = Math.max(1, Math.min(QUEENS_LEVEL_COUNT, lvl))
    start(clamped)
  }

  const cellSize =
    puzzle.size === 7
      ? "size-11.5"
      : puzzle.size === 6
        ? "size-13"
        : "size-15.5"

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex w-full max-w-xs items-center justify-between">
        <p className="text-body text-muted-foreground">
          {gameState === "won"
            ? `關卡 ${level}，已完成 ${queenCount} / ${numRegions}`
            : gameState === "playing"
              ? `關卡 ${level}，已放 ${queenCount} / ${numRegions}`
              : "按下開始，從第一關出發"}
        </p>
        <Button variant="outline" onClick={() => start(level)}>
          {gameState === "idle" ? "開始遊戲" : "重新開始"}
        </Button>
      </div>

      {gameState === "idle" ? (
        <div className="max-w-xs space-y-1 py-6 text-center text-body text-muted-foreground">
          <p>每個顏色區域恰好放一個 ♛</p>
          <p>每行每列只能有一個 ♛</p>
          <p>♛ 之間不得相鄰（含對角線）</p>
          <p className="pt-2 text-body">
            點 1 下標 ✕（標非 ♛）／ 2 下放 ♛ ／ 3 下清空
          </p>
          <p className="pt-1 text-body">共 {QUEENS_LEVEL_COUNT} 關</p>
        </div>
      ) : (
        <>
          <div
            className={`grid overflow-hidden rounded-control border ${gridCols[puzzle.size] ?? "grid-cols-7"}`}
          >
            {puzzle.regions.map((row, r) =>
              row.map((regionId, c) => {
                const cell = placement[r]?.[c] ?? 0
                const hasMark = cell === 1
                const hasQueen = cell === 2
                const isViolation = violations.has(`${r},${c}`)
                const colorClass = REGION_COLORS[regionId] ?? "bg-muted"

                const borderTop =
                  r > 0 && puzzle.regions[r - 1]?.[c] !== regionId
                    ? "border-t-2 border-t-foreground/60"
                    : "border-t border-t-foreground/10"
                const borderLeft =
                  c > 0 && puzzle.regions[r]?.[c - 1] !== regionId
                    ? "border-l-2 border-l-foreground/60"
                    : "border-l border-l-foreground/10"

                const stateLabel = hasQueen
                  ? "，已放皇后"
                  : hasMark
                    ? "，已標記非皇后"
                    : ""

                return (
                  <button
                    key={`${r},${c}`}
                    onClick={() => handleCellClick(r, c)}
                    aria-label={`第 ${r + 1} 行第 ${c + 1} 列，區域 ${regionId + 1}${stateLabel}${isViolation ? "（違規）" : ""}`}
                    aria-pressed={hasQueen}
                    disabled={gameState !== "playing"}
                    className={`relative flex cursor-pointer items-center justify-center transition-colors select-none ${colorClass} ${borderTop} ${borderLeft} ${
                      isViolation ? "ring-2 ring-destructive ring-inset" : ""
                    } ${cellSize} disabled:cursor-default`}
                  >
                    {hasQueen && (
                      <span
                        className={`text-title leading-none select-none ${isViolation ? "opacity-50" : ""}`}
                      >
                        ♛
                      </span>
                    )}
                    {hasMark && (
                      <span
                        aria-hidden
                        className="text-title leading-none text-foreground/40 select-none"
                      >
                        ✕
                      </span>
                    )}
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
              {level} / {QUEENS_LEVEL_COUNT}
            </span>
            <Button
              variant="outline"
              onClick={() => goToLevel(level + 1)}
              disabled={level >= QUEENS_LEVEL_COUNT}
              aria-label="下一關"
            >
              →
            </Button>
          </div>
        </>
      )}

      {gameState === "won" && (
        <p className="font-medium text-success">🎉 完美放置！</p>
      )}
    </div>
  )
}
