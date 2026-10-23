"use server"

import { errorMessage, runAction } from "@/lib/actions/define"
import { listGameLeaderboard, recordGameScore } from "@/lib/actions/games"
import { requireActor } from "@/lib/auth/session"
import type { GameType } from "@/lib/games/types"

export async function loadLeaderboard(game: GameType, level: number | null) {
  const actor = await requireActor("/games")
  return runAction(listGameLeaderboard, actor, { game, level })
}

export async function submitScore(input: {
  game: GameType
  score: number
  finishTimeMs: number
  level: number | null
}) {
  const actor = await requireActor("/games")
  try {
    await runAction(recordGameScore, actor, {
      ...input,
      score: Math.floor(input.score),
      finishTimeMs: Math.floor(input.finishTimeMs),
    })
    return {}
  } catch (error) {
    return { error: errorMessage(error) }
  }
}
