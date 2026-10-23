import type { GameMeta, GameType } from "./types"

export const GAME_META: Record<GameType, GameMeta> = {
  pipes: {
    slug: "pipes",
    title: "水管接龍",
    description: "旋轉管道，讓所有端點與水源相連！",
    icon: "🔧",
    scoreLabel: (score) => `${score} 端點`,
    timeLabel: "完成時間",
  },
  queens: {
    slug: "queens",
    title: "皇后謎題",
    description: "每個色區放一個皇后，且不得相鄰！",
    icon: "♛",
    scoreLabel: () => "完成",
    timeLabel: "完成時間",
  },
  "2048": {
    slug: "2048",
    title: "2048",
    description: "合併數字方塊，挑戰達到 2048！",
    icon: "🎯",
    scoreLabel: (score) => score.toString(),
    timeLabel: "完成時間",
  },
  memory: {
    slug: "memory",
    title: "翻牌記憶",
    description: "找到所有配對，越快越好！",
    icon: "🃏",
    scoreLabel: () => "完成",
    timeLabel: "完成時間",
  },
  typing: {
    slug: "typing",
    title: "打字測速",
    description: "測試你的打字速度，挑戰最高 WPM！",
    icon: "⌨️",
    scoreLabel: (score) => `${Math.round(score / 10)} WPM`,
    timeLabel: "完成時間",
  },
  snake: {
    slug: "snake",
    title: "貪食蛇",
    description: "吃越多食物，分數越高！",
    icon: "🐍",
    scoreLabel: (score) => `${score} 分`,
    timeLabel: "存活時間",
  },
}

export const GAME_ORDER: GameType[] = [
  "pipes",
  "queens",
  "2048",
  "memory",
  "typing",
  "snake",
]

export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const centiseconds = Math.floor((ms % 1000) / 10)
  if (minutes > 0) {
    return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`
  }
  return `${seconds}.${String(centiseconds).padStart(2, "0")}s`
}
