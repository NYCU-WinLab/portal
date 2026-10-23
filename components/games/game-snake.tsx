"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { GameResult } from "@/lib/games/types"

const COLS = 20
const ROWS = 20
const TICK_MS = 130

type Pos = { r: number; c: number }
type Dir = "up" | "down" | "left" | "right"
type State = "idle" | "playing" | "dead"

const DIR_DELTA: Record<Dir, Pos> = {
  up: { r: -1, c: 0 },
  down: { r: 1, c: 0 },
  left: { r: 0, c: -1 },
  right: { r: 0, c: 1 },
}

function randomFood(snake: Pos[]): Pos {
  const occupied = new Set(snake.map((p) => `${p.r},${p.c}`))
  let pos: Pos
  do {
    pos = {
      r: Math.floor(Math.random() * ROWS),
      c: Math.floor(Math.random() * COLS),
    }
  } while (occupied.has(`${pos.r},${pos.c}`))
  return pos
}

interface GameSnakeProps {
  onComplete: (result: GameResult) => void
}

export function GameSnake({ onComplete }: GameSnakeProps) {
  const [snake, setSnake] = useState<Pos[]>([])
  const [food, setFood] = useState<Pos>({ r: 5, c: 15 })
  const [, setDir] = useState<Dir>("right")
  const [state, setState] = useState<State>("idle")
  const [score, setScore] = useState(0)

  const dirRef = useRef<Dir>("right")
  // Direction the snake actually moved on the last tick. Guards against
  // queuing two keystrokes inside one tick window (e.g. right → down → left)
  // which would otherwise let the snake U-turn 180° and crash into itself.
  const movedDirRef = useRef<Dir>("right")
  const snakeRef = useRef<Pos[]>([])
  const foodRef = useRef<Pos>({ r: 5, c: 15 })
  const startRef = useRef<number | null>(null)
  const completedRef = useRef(false)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  const start = useCallback(() => {
    const initSnake = [
      { r: 10, c: 12 },
      { r: 10, c: 11 },
      { r: 10, c: 10 },
    ]
    const initFood = randomFood(initSnake)
    completedRef.current = false
    snakeRef.current = initSnake
    foodRef.current = initFood
    dirRef.current = "right"
    movedDirRef.current = "right"
    setSnake(initSnake)
    setFood(initFood)
    setDir("right")
    setScore(0)
    setState("playing")
    startRef.current = Date.now()
  }, [])

  useEffect(() => {
    if (state !== "playing") return

    const interval = setInterval(() => {
      const d = dirRef.current
      movedDirRef.current = d
      const delta = DIR_DELTA[d]
      const head = snakeRef.current[0]
      if (!head) return
      const next = { r: head.r + delta.r, c: head.c + delta.c }

      // When the snake doesn't eat this tick, the tail vacates its cell on the
      // same tick the head moves in. Self-collision must check against the
      // body *after* removing the tail, otherwise a tight U-turn into the
      // tail's old cell is wrongly counted as a crash.
      const ate = next.r === foodRef.current.r && next.c === foodRef.current.c
      const body = ate ? snakeRef.current : snakeRef.current.slice(0, -1)

      if (
        next.r < 0 ||
        next.r >= ROWS ||
        next.c < 0 ||
        next.c >= COLS ||
        body.some((p) => p.r === next.r && p.c === next.c)
      ) {
        if (!completedRef.current) {
          completedRef.current = true
          const ms = Date.now() - (startRef.current ?? Date.now())
          const finalScore = snakeRef.current.length - 3
          setState("dead")
          // Skip leaderboard submission for trivial runs (0 食物 or < 1s)
          if (finalScore > 0 && ms >= 1000) {
            onComplete({ score: finalScore, finishTimeMs: ms })
          }
        }
        return
      }

      const newSnake = ate
        ? [next, ...snakeRef.current]
        : [next, ...snakeRef.current.slice(0, -1)]

      snakeRef.current = newSnake
      if (ate) {
        const newFood = randomFood(newSnake)
        foodRef.current = newFood
        setFood(newFood)
        setScore(newSnake.length - 3)
      }
      setSnake([...newSnake])
    }, TICK_MS)

    return () => clearInterval(interval)
  }, [state, onComplete])

  const applyDir = useCallback((next: Dir) => {
    const opposite: Record<Dir, Dir> = {
      up: "down",
      down: "up",
      left: "right",
      right: "left",
    }
    // Guard against the last committed direction, not the last queued one ，
    // otherwise two fast keypresses can chain a 180° reversal inside one tick.
    if (next !== opposite[movedDirRef.current]) {
      dirRef.current = next
      setDir(next)
    }
  }, [])

  useEffect(() => {
    if (state !== "playing") return
    const handler = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      }
      const next = map[e.key]
      if (!next) return
      e.preventDefault()
      applyDir(next)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [state, applyDir])

  const snakeSet = new Set(snake.map((p) => `${p.r},${p.c}`))
  const isHead = (r: number, c: number) =>
    snake[0]?.r === r && snake[0]?.c === c
  const isFood = (r: number, c: number) => food.r === r && food.c === c

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex w-full max-w-sm items-center justify-between">
        <div className="text-body text-muted-foreground">
          分數 <span className="font-medium text-foreground">{score}</span>
        </div>
        <Button variant="outline" onClick={start}>
          {state === "idle" ? "開始遊戲" : "重新開始"}
        </Button>
      </div>

      <div
        className="size-90 max-w-full touch-none overflow-hidden rounded-control border"
        onTouchStart={(e) => {
          const t = e.touches[0]
          if (!t) return
          touchStartRef.current = { x: t.clientX, y: t.clientY }
        }}
        onTouchEnd={(e) => {
          const start = touchStartRef.current
          if (!start || state !== "playing") return
          const t = e.changedTouches[0]
          if (!t) return
          const dx = t.clientX - start.x
          const dy = t.clientY - start.y
          if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return
          if (Math.abs(dx) > Math.abs(dy)) {
            applyDir(dx > 0 ? "right" : "left")
          } else {
            applyDir(dy > 0 ? "down" : "up")
          }
          touchStartRef.current = null
        }}
      >
        <div className="relative grid grid-cols-20 grid-rows-20">
          {Array.from({ length: ROWS * COLS }).map((_, idx) => {
            const r = Math.floor(idx / COLS)
            const c = idx % COLS
            const key = `${r},${c}`
            const inSnake = snakeSet.has(key)
            const head = isHead(r, c)
            const foodCell = isFood(r, c)
            return (
              <div
                key={key}
                className={
                  head
                    ? "size-4.5 rounded-control bg-success"
                    : inSnake
                      ? "size-4.5 rounded-control bg-success/60"
                      : foodCell
                        ? "size-4.5 rounded-full bg-destructive"
                        : (r + c) % 2 === 0
                          ? "size-4.5 bg-muted/30"
                          : "bg-muted/10"
                }
              />
            )
          })}
        </div>
      </div>

      {state === "idle" && (
        <p className="text-body text-muted-foreground">
          使用方向鍵控制蛇的移動
        </p>
      )}
      {state === "dead" && (
        <p className="font-medium text-destructive">遊戲結束！得 {score} 分</p>
      )}
    </div>
  )
}
