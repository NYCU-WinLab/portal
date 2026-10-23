"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { GameResult } from "@/lib/games/types"

type Grid = number[][]
type Dir = "up" | "down" | "left" | "right"
type GameState = "idle" | "playing" | "won" | "lost"

function createEmpty(): Grid {
  return Array.from({ length: 4 }, () => Array(4).fill(0))
}

function addRandom(grid: Grid): Grid {
  const empty: [number, number][] = []
  grid.forEach((row, r) => row.forEach((v, c) => !v && empty.push([r, c])))
  if (!empty.length) return grid
  const pick = empty[Math.floor(Math.random() * empty.length)]!
  const [r, c] = pick
  const next = grid.map((row) => [...row])
  next[r]![c] = Math.random() < 0.9 ? 2 : 4
  return next
}

function slideRow(row: number[]): { row: number[]; merged: boolean } {
  const vals = row.filter(Boolean) as number[]
  let merged = false
  for (let i = 0; i < vals.length - 1; i++) {
    if (vals[i] === vals[i + 1]) {
      vals[i]! *= 2
      vals.splice(i + 1, 1)
      merged = true
    }
  }
  return { row: [...vals, ...Array<number>(4 - vals.length).fill(0)], merged }
}

function cell(grid: Grid, r: number, c: number): number {
  return grid[r]?.[c] ?? 0
}

function moveGrid(grid: Grid, dir: Dir): { grid: Grid; changed: boolean } {
  let changed = false
  const next = grid.map((row) => [...row])

  if (dir === "left") {
    for (let r = 0; r < 4; r++) {
      const row = next[r]!
      const { row: result, merged } = slideRow(row)
      if (merged || result.some((v, i) => v !== row[i])) changed = true
      next[r] = result
    }
  } else if (dir === "right") {
    for (let r = 0; r < 4; r++) {
      const row = next[r]!
      const rev = [...row].reverse()
      const { row: result, merged } = slideRow(rev)
      const final = result.reverse()
      if (merged || final.some((v, i) => v !== row[i])) changed = true
      next[r] = final
    }
  } else if (dir === "up") {
    for (let c = 0; c < 4; c++) {
      const col = next.map((row) => row[c] ?? 0)
      const { row: result, merged } = slideRow(col)
      if (merged || result.some((v, i) => v !== col[i])) changed = true
      result.forEach((v, i) => {
        next[i]![c] = v
      })
    }
  } else {
    for (let c = 0; c < 4; c++) {
      const origCol = next.map((row) => row[c] ?? 0)
      const { row: result, merged } = slideRow([...origCol].reverse())
      const final = result.reverse()
      if (merged || final.some((v, i) => v !== origCol[i])) changed = true
      final.forEach((v, i) => {
        next[i]![c] = v
      })
    }
  }
  return { grid: next, changed }
}

function hasMovesLeft(grid: Grid): boolean {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (!cell(grid, r, c)) return true
      if (c < 3 && cell(grid, r, c) === cell(grid, r, c + 1)) return true
      if (r < 3 && cell(grid, r, c) === cell(grid, r + 1, c)) return true
    }
  }
  return false
}

const TILE_COLORS: Record<number, string> = {
  0: "bg-background/40 dark:bg-background/20",
  2: "bg-muted text-foreground",
  4: "bg-primary/10 text-foreground",
  8: "bg-primary/20 text-foreground",
  16: "bg-primary/30 text-foreground",
  32: "bg-primary/40 text-foreground",
  64: "bg-primary/50 text-foreground",
  128: "bg-warning/40 text-foreground",
  256: "bg-warning/60 text-foreground",
  512: "bg-warning/80 text-foreground",
  1024: "bg-success/70 text-foreground",
  2048: "bg-success text-background font-medium",
}

function tileColor(v: number) {
  return TILE_COLORS[v] ?? "bg-primary text-primary-foreground font-medium"
}

interface Game2048Props {
  onComplete: (result: GameResult) => void
}

export function Game2048({ onComplete }: Game2048Props) {
  const [grid, setGrid] = useState<Grid>(createEmpty)
  const [state, setState] = useState<GameState>("idle")
  const startRef = useRef<number | null>(null)
  const completedRef = useRef(false)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  const start = useCallback(() => {
    completedRef.current = false
    const g = addRandom(addRandom(createEmpty()))
    setGrid(g)
    setState("playing")
    startRef.current = Date.now()
  }, [])

  const handleMove = useCallback(
    (dir: Dir) => {
      if (state !== "playing") return
      setGrid((prev) => {
        const { grid: next, changed } = moveGrid(prev, dir)
        if (!changed) return prev
        const withNew = addRandom(next)
        const maxTile = Math.max(...withNew.flat())

        if (maxTile >= 2048 && !completedRef.current) {
          completedRef.current = true
          const ms = Date.now() - (startRef.current ?? Date.now())
          setState("won")
          setTimeout(
            () => onComplete({ score: maxTile, finishTimeMs: ms }),
            100
          )
        } else if (!hasMovesLeft(withNew)) {
          setState("lost")
        }
        return withNew
      })
    },
    [state, onComplete]
  )

  useEffect(() => {
    if (state !== "playing") return
    const handler = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      }
      const dir = map[e.key]
      if (dir) {
        e.preventDefault()
        handleMove(dir)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [state, handleMove])

  const maxTile = Math.max(...grid.flat())

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex w-full max-w-xs items-center justify-between">
        <div className="text-body text-muted-foreground">
          最高{" "}
          <span className="font-medium text-foreground">{maxTile || 0}</span>
        </div>
        <Button variant="outline" onClick={start}>
          {state === "idle" ? "開始遊戲" : "重新開始"}
        </Button>
      </div>

      <div
        className="grid w-full max-w-xs touch-none grid-cols-4 gap-2 rounded-control bg-muted/60 p-3"
        onTouchStart={(e) => {
          const t = e.touches[0]
          if (!t) return
          touchStartRef.current = { x: t.clientX, y: t.clientY }
        }}
        onTouchEnd={(e) => {
          const startTouch = touchStartRef.current
          if (!startTouch || state !== "playing") return
          const t = e.changedTouches[0]
          if (!t) return
          const dx = t.clientX - startTouch.x
          const dy = t.clientY - startTouch.y
          if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return
          handleMove(
            Math.abs(dx) > Math.abs(dy)
              ? dx > 0
                ? "right"
                : "left"
              : dy > 0
                ? "down"
                : "up"
          )
          touchStartRef.current = null
        }}
      >
        {grid.flat().map((v, i) => (
          <div
            key={i}
            className={`flex aspect-square items-center justify-center rounded-control text-title font-medium transition-all duration-state ${tileColor(v)}`}
          >
            {v > 0 ? v : ""}
          </div>
        ))}
      </div>

      {state === "won" && (
        <p className="font-medium text-success">🎉 達到 {maxTile}！</p>
      )}
      {state === "lost" && (
        <p className="font-medium text-destructive">遊戲結束！最高 {maxTile}</p>
      )}
      {state === "idle" && (
        <p className="text-body text-muted-foreground">使用方向鍵移動方塊</p>
      )}
    </div>
  )
}
