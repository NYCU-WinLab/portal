"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { GameResult } from "@/lib/games/types"

const EMOJIS = ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼"]

interface Card {
  id: number
  emoji: string
  flipped: boolean
  matched: boolean
}

function buildDeck(): Card[] {
  const cards = [...EMOJIS, ...EMOJIS]
    .map((emoji, i) => ({ id: i, emoji, flipped: false, matched: false }))
    .sort(() => Math.random() - 0.5)
    .map((card, i) => ({ ...card, id: i }))
  return cards
}

interface GameMemoryProps {
  onComplete: (result: GameResult) => void
}

export function GameMemory({ onComplete }: GameMemoryProps) {
  const [cards, setCards] = useState<Card[]>([])
  const [flippedIds, setFlippedIds] = useState<number[]>([])
  const [moves, setMoves] = useState(0)
  const [started, setStarted] = useState(false)
  const [completed, setCompleted] = useState(false)
  const startRef = useRef<number | null>(null)
  const lockRef = useRef(false)
  const completedRef = useRef(false)
  // Mirror of cards state for effect reads without stale closure
  const cardsRef = useRef<Card[]>([])

  useEffect(() => {
    cardsRef.current = cards
  }, [cards])

  const start = useCallback(() => {
    completedRef.current = false
    const deck = buildDeck()
    cardsRef.current = deck
    setCards(deck)
    setFlippedIds([])
    setMoves(0)
    setStarted(true)
    setCompleted(false)
    startRef.current = Date.now()
    lockRef.current = false
  }, [])

  const handleFlip = useCallback(
    (id: number) => {
      if (lockRef.current || !started) return
      setCards((prev) => {
        const card = prev[id]
        if (!card || card.matched || card.flipped) return prev
        return prev.map((c) => (c.id === id ? { ...c, flipped: true } : c))
      })
      setFlippedIds((prev) => {
        if (prev.length === 1 && prev[0] !== id) return [...prev, id]
        if (prev.length === 0) return [id]
        return prev
      })
    },
    [started]
  )

  useEffect(() => {
    if (flippedIds.length !== 2) return
    // Count one move per pair attempt. The pair is resolved here, after
    // the second card has rendered face up.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMoves((m) => m + 1)
    lockRef.current = true
    const a = flippedIds[0]!
    const b = flippedIds[1]!
    // Use cardsRef so we read up-to-date emoji values without stale closure
    const ca = cardsRef.current[a]
    const cb = cardsRef.current[b]

    if (ca?.emoji === cb?.emoji) {
      setCards((prev) => {
        const next = prev.map((c) =>
          c.id === a || c.id === b ? { ...c, matched: true } : c
        )
        if (next.every((c) => c.matched) && !completedRef.current) {
          completedRef.current = true
          const ms = Date.now() - startRef.current!
          setCompleted(true)
          setTimeout(
            () => onComplete({ score: EMOJIS.length, finishTimeMs: ms }),
            200
          )
        }
        return next
      })
      setFlippedIds([])
      lockRef.current = false
    } else {
      const timer = setTimeout(() => {
        setCards((prev) =>
          prev.map((c) =>
            c.id === a || c.id === b ? { ...c, flipped: false } : c
          )
        )
        setFlippedIds([])
        lockRef.current = false
      }, 900)
      return () => clearTimeout(timer)
    }
  }, [flippedIds, onComplete])

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex w-full max-w-xs items-center justify-between">
        <div className="text-body text-muted-foreground">
          翻牌 <span className="font-medium text-foreground">{moves}</span> 次
        </div>
        <Button variant="outline" onClick={start}>
          {!started ? "開始遊戲" : "重新開始"}
        </Button>
      </div>

      {!started ? (
        <p className="py-8 text-body text-muted-foreground">點擊「開始遊戲」</p>
      ) : (
        <div className="grid w-full max-w-xs grid-cols-4 gap-2">
          {cards.map((card) => (
            <button
              key={card.id}
              onClick={() => handleFlip(card.id)}
              className={`flex aspect-square cursor-pointer items-center justify-center rounded-control border-2 text-title transition-all duration-state select-none ${
                card.matched
                  ? "border-success bg-success/10 opacity-60"
                  : card.flipped
                    ? "border-foreground/20 bg-background"
                    : "border-muted bg-muted hover:bg-muted/70"
              }`}
            >
              {card.flipped || card.matched ? card.emoji : "?"}
            </button>
          ))}
        </div>
      )}

      {completed && (
        <p className="font-medium text-success">🎉 完成！翻了 {moves} 次</p>
      )}
    </div>
  )
}
