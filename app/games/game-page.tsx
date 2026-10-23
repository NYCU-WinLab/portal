"use client"

import * as React from "react"
import { toast } from "sonner"

import { SectionHeader } from "@/components/page-header"
import { GAME_META, formatTime } from "@/lib/games/constants"
import type { GameResult, GameType } from "@/lib/games/types"

import { submitScore } from "./actions"
import { Game2048 } from "@/components/games/game-2048"
import { GameMemory } from "@/components/games/game-memory"
import { GamePipes } from "@/components/games/game-pipes"
import { GameQueens } from "@/components/games/game-queens"
import { GameSnake } from "@/components/games/game-snake"
import { GameTyping } from "@/components/games/game-typing"
import { Scoreboard } from "./scoreboard"

type Props = {
  onComplete: (result: GameResult) => void
  onLevelChange: (level: number | null, label?: string | null) => void
}

const boards: Record<GameType, (props: Props) => React.ReactNode> = {
  "2048": ({ onComplete }) => <Game2048 onComplete={onComplete} />,
  memory: ({ onComplete }) => <GameMemory onComplete={onComplete} />,
  typing: (p) => <GameTyping {...p} />,
  snake: ({ onComplete }) => <GameSnake onComplete={onComplete} />,
  pipes: (p) => <GamePipes {...p} />,
  queens: (p) => <GameQueens {...p} />,
}

// A game beside its leaderboard; a finished game is recorded and the board
// reloads.
export function GamePage({ gameType }: { gameType: GameType }) {
  const meta = GAME_META[gameType]
  const [level, setLevel] = React.useState<number | null>(null)
  const [label, setLabel] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState(0)

  const onComplete = React.useCallback(
    async (result: GameResult) => {
      const { error } = await submitScore({ game: gameType, level, ...result })
      if (error) toast.error(error)
      else {
        toast.success(
          `已記錄：${meta.scoreLabel(result.score)}，${formatTime(result.finishTimeMs)}`
        )
        setVersion((v) => v + 1)
      }
    },
    [gameType, level, meta]
  )
  const onLevelChange = React.useCallback(
    (next: number | null, nextLabel?: string | null) => {
      setLevel(next)
      setLabel(nextLabel ?? null)
    },
    []
  )

  return (
    <div className="flex flex-col gap-12 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <p className="text-muted-foreground">{meta.description}</p>
        {boards[gameType]({ onComplete, onLevelChange })}
      </div>
      <section className="flex flex-col gap-2 lg:w-80 lg:shrink-0">
        <SectionHeader
          title={
            level === null ? "排行榜" : `排行榜，${label ?? `第 ${level} 關`}`
          }
        />
        <Scoreboard gameType={gameType} level={level} version={version} />
      </section>
    </div>
  )
}
