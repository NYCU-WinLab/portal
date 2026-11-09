"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  BLACK,
  EMPTY,
  MAX_BLACK_MOVES,
  SIZE,
  WHITE,
  computerMove,
  winningLine,
  type Stone,
} from "@/lib/games/gomoku"
import type { GameResult } from "@/lib/games/types"

type State = "idle" | "playing" | "won" | "lost" | "draw"

const emptyBoard = (): Stone[] => Array<Stone>(SIZE * SIZE).fill(EMPTY)

interface GameGomokuProps {
  onComplete: (result: GameResult) => void
}

export function GameGomoku({ onComplete }: GameGomokuProps) {
  const [board, setBoard] = useState<Stone[]>(emptyBoard)
  const [state, setState] = useState<State>("idle")
  const [moves, setMoves] = useState(0)
  const [last, setLast] = useState<number | null>(null)
  const [line, setLine] = useState<number[]>([])
  const [thinking, setThinking] = useState(false)
  const startRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  const start = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setBoard(emptyBoard())
    setState("playing")
    setMoves(0)
    setLast(null)
    setLine([])
    setThinking(false)
    startRef.current = Date.now()
  }, [])

  const play = useCallback(
    (cell: number) => {
      if (state !== "playing" || thinking || board[cell] !== EMPTY) return
      const next = [...board]
      next[cell] = BLACK
      const made = moves + 1
      setBoard(next)
      setMoves(made)
      setLast(cell)
      const won = winningLine(next, cell)
      if (won) {
        setLine(won)
        setState("won")
        onComplete({
          score: MAX_BLACK_MOVES - made,
          finishTimeMs: Date.now() - startRef.current,
        })
        return
      }
      if (!next.includes(EMPTY)) {
        setState("draw")
        return
      }
      setThinking(true)
      timerRef.current = setTimeout(() => {
        const reply = computerMove(next)
        const after = [...next]
        after[reply] = WHITE
        setBoard(after)
        setLast(reply)
        setThinking(false)
        const lost = winningLine(after, reply)
        if (lost) {
          setLine(lost)
          setState("lost")
        } else if (!after.includes(EMPTY)) setState("draw")
      }, 300)
    },
    [board, moves, onComplete, state, thinking]
  )

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex w-full max-w-md items-center justify-between">
        <p className="text-body text-muted-foreground">
          {state === "idle"
            ? "你執黑先下，連成 5 子就贏"
            : thinking
              ? "電腦思考中"
              : `已下 ${moves} 手`}
        </p>
        <Button variant="outline" onClick={start}>
          {state === "idle" ? "開始遊戲" : "重新開始"}
        </Button>
      </div>

      <div className="grid aspect-square w-full max-w-md grid-cols-15 rounded-control bg-muted p-1 select-none">
        {board.map((stone, cell) => {
          const r = Math.floor(cell / SIZE)
          const c = cell % SIZE
          const inLine = line.includes(cell)
          return (
            <button
              key={cell}
              onClick={() => play(cell)}
              disabled={state !== "playing" || thinking || stone !== EMPTY}
              aria-label={`第 ${r + 1} 行第 ${c + 1} 列${stone === BLACK ? "，黑子" : stone === WHITE ? "，白子" : ""}`}
              className="group relative flex items-center justify-center disabled:cursor-default"
            >
              <span
                aria-hidden
                className={`absolute top-1/2 h-px bg-foreground/30 ${c === 0 ? "left-1/2" : "left-0"} ${c === SIZE - 1 ? "right-1/2" : "right-0"}`}
              />
              <span
                aria-hidden
                className={`absolute left-1/2 w-px bg-foreground/30 ${r === 0 ? "top-1/2" : "top-0"} ${r === SIZE - 1 ? "bottom-1/2" : "bottom-0"}`}
              />
              {stone !== EMPTY ? (
                <span
                  aria-hidden
                  className={`relative size-5/6 rounded-full ${
                    stone === BLACK
                      ? "bg-foreground"
                      : "border border-foreground/40 bg-background"
                  } ${
                    inLine
                      ? "ring-2 ring-success"
                      : cell === last
                        ? "ring-2 ring-primary"
                        : ""
                  }`}
                />
              ) : (
                state === "playing" &&
                !thinking && (
                  <span
                    aria-hidden
                    className="relative size-5/6 rounded-full bg-foreground/0 transition-colors duration-state group-hover:bg-foreground/20"
                  />
                )
              )}
            </button>
          )
        })}
      </div>

      {state === "won" && (
        <p className="font-medium text-success">🎉 你贏了！用了 {moves} 手</p>
      )}
      {state === "lost" && (
        <p className="font-medium text-destructive">電腦連成 5 子，再試一次</p>
      )}
      {state === "draw" && (
        <p className="font-medium text-muted-foreground">棋盤下滿，和局</p>
      )}
    </div>
  )
}
