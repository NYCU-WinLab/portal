import { EmptyState } from "@/components/empty-state"
import { SectionHeader } from "@/components/page-header"
import type { listActivity } from "@/lib/actions/music"

type Entry = Awaited<ReturnType<typeof listActivity.run>>["activities"][number]

const time = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

function sentence(entry: Entry) {
  const song = entry.title ? `〈${entry.title}〉` : ""
  switch (entry.kind) {
    case "add":
      return `點了${song}`
    case "next":
      return `把${song}排到下一首`
    case "cut_in":
      return `插播${song}`
    case "playlist":
      return `加入歌單〈${entry.detail?.title ?? ""}〉${entry.detail?.count ?? 0} 首`
    case "skip":
      return `跳過${song}`
    case "remove":
      return `把${song}移出佇列`
    case "pause":
      return "暫停"
    case "resume":
      return "繼續播放"
    case "auto":
      return `自動推薦${song}`
    case "autoplay":
      return entry.detail?.on ? "打開自動推薦" : "關掉自動推薦"
    case "volume":
      return `把音量調到 ${entry.detail?.volume ?? ""}`
  }
}

// Who did what, newest first.
export function Activity({ activities }: { activities: Entry[] }) {
  return (
    <section aria-label="動態" className="flex flex-col gap-4">
      <SectionHeader title="動態" />
      {activities.length ? (
        <ul className="flex flex-col">
          {activities.map((entry) => (
            <li
              key={entry.id}
              className="flex gap-4 border-b border-border py-3"
            >
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {time.format(entry.createdAt)}
              </span>
              <span className="min-w-0">
                {entry.kind !== "auto" && `${entry.who ?? "有人"} `}
                {sentence(entry)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState noun="動態" />
      )}
    </section>
  )
}
