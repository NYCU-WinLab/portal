import { cn } from "@/lib/utils"

/** m:ss */
export function duration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return ""
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** A track's length, or 直播 for a live stream, which has none. */
export function length(seconds: number | null | undefined) {
  return seconds ? duration(seconds) : "直播"
}

/** The cover art, square, from YouTube. */
export function Cover({
  src,
  className,
}: {
  src: string | null
  className?: string
}) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- remote YouTube art at its own size
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      className={cn(
        "shrink-0 rounded-control bg-muted object-cover",
        className
      )}
    />
  ) : (
    <div className={cn("shrink-0 rounded-control bg-muted", className)} />
  )
}

export const addedAsLabel = {
  queue: "點播",
  next: "排下一首",
  cut_in: "插播",
  auto: "自動推薦",
} as const

/** Who brought a song and how: "小明 點播", "小明 的歌單", "自動推薦". A
 * space keeps the name apart from the words after it. */
export function addedLine(item: {
  addedAs: keyof typeof addedAsLabel
  addedBy: string | null
  fromPlaylist: boolean
}) {
  if (item.addedAs === "auto") return addedAsLabel.auto
  return `${item.addedBy ?? "有人"} ${item.fromPlaylist ? "的歌單" : addedAsLabel[item.addedAs]}`
}
