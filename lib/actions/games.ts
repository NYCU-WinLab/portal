import { and, desc, eq, gte, sql } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { gameScores, user } from "@/lib/db/schema"

// The lab's small games (/games) and their leaderboards.

export const games = [
  "2048",
  "memory",
  "typing",
  "snake",
  "pipes",
  "queens",
] as const
const game = z.enum(games)

export const listGameLeaderboard = defineAction({
  name: "list_game_leaderboard",
  title: "遊戲排行榜",
  description:
    "The top 20 members of one game on /games (2048, memory, typing, snake, pipes, queens), each by their best score (higher first, then faster finish_time_ms); level narrows typing (0 to 5), pipes and queens (1 to 100) to one level.",
  kind: "query",
  input: z.object({ game, level: z.number().int().min(0).max(100).nullish() }),
  run: async (_actor, input) => {
    const best = db
      .selectDistinctOn([gameScores.userId], {
        userId: gameScores.userId,
        score: gameScores.score,
        finishTimeMs: gameScores.finishTimeMs,
        at: gameScores.createdAt,
      })
      .from(gameScores)
      .where(
        and(
          eq(gameScores.game, input.game),
          input.level === undefined || input.level === null
            ? undefined
            : eq(gameScores.level, input.level)
        )
      )
      .orderBy(
        gameScores.userId,
        desc(gameScores.score),
        gameScores.finishTimeMs
      )
      .as("best")
    return {
      scores: await db
        .select({
          userId: best.userId,
          name: user.name,
          score: best.score,
          finishTimeMs: best.finishTimeMs,
          at: best.at,
        })
        .from(best)
        .innerJoin(user, eq(user.id, best.userId))
        .orderBy(desc(best.score), best.finishTimeMs)
        .limit(20),
    }
  },
})

/** Why a result is impossible for its game, or null. */
function impossible(g: string, score: number, level: number | null) {
  const levels = (min: number, max: number) =>
    level === null || level < min || level > max
  switch (g) {
    case "2048":
      return (
        level !== null ||
        score < 2 ||
        (score & (score - 1)) !== 0 ||
        score > 131072
      )
    case "memory":
      return level !== null || score !== 8
    case "typing":
      return score < 0 || score > 3000 || levels(0, 5)
    case "snake":
      return level !== null || score < 0 || score > 397
    case "pipes":
      return score < 0 || score > 100 || levels(1, 100)
    case "queens":
      return (
        levels(1, 100) || score !== (level! <= 30 ? 5 : level! <= 60 ? 6 : 7)
      )
  }
  return true
}

export const recordGameScore = defineAction({
  name: "record_game_score",
  title: "記錄遊戲成績",
  description:
    "Records a finished game for the signed-in member, from the game page.",
  kind: "mutation",
  mcpExcludedBecause:
    "a score is what the member played; an agent has nothing to submit",
  input: z.object({
    game,
    score: z.number().int(),
    finishTimeMs: z
      .number()
      .int()
      .min(1)
      .max(30 * 60 * 1000),
    level: z.number().int().nullable(),
  }),
  run: async (actor, input) => {
    if (impossible(input.game, input.score, input.level))
      throw new Error("這個成績不可能")
    const [recent] = await db
      .select({ id: gameScores.id })
      .from(gameScores)
      .where(
        and(
          eq(gameScores.userId, actor.userId),
          eq(gameScores.game, input.game),
          gte(gameScores.createdAt, sql`now() - interval '2 seconds'`)
        )
      )
      .limit(1)
    if (recent) throw new Error("太快了，等一下再送")
    await db.insert(gameScores).values({ userId: actor.userId, ...input })
    return { recorded: true }
  },
})
