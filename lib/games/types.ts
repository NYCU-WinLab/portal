export type GameType =
  "2048" | "memory" | "typing" | "snake" | "pipes" | "queens"

export interface GameScore {
  user_id: string
  user_name: string
  score: number
  finish_time_ms: number
  achieved_at: string
  level?: number | null
}

export interface GameResult {
  score: number
  finishTimeMs: number
}

export interface GameMeta {
  slug: GameType
  title: string
  description: string
  icon: string
  scoreLabel: (score: number) => string
  timeLabel: string
}
