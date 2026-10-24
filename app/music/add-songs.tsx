"use client"

import { ListPlusIcon, ListStartIcon, ZapIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { searchMusic } from "@/lib/actions/music"

import { add, addList, search } from "./actions"
import { ok } from "./ok"
import { Cover, length } from "./song"

type Found = Awaited<ReturnType<typeof searchMusic.run>>

// One box for everything: type a song to search YouTube Music, or paste a
// song or playlist link. Results come as you type.
export function AddSongs() {
  const [query, setQuery] = React.useState("")
  const [found, setFound] = React.useState<Found | null>(null)
  const [searching, setSearching] = React.useState(false)
  const latest = React.useRef("")

  React.useEffect(() => {
    const text = query.trim()
    latest.current = text
    if (!text) return
    const timer = setTimeout(async () => {
      setSearching(true)
      const result = await search({ query: text })
      if (latest.current !== text) return
      setSearching(false)
      if (ok(result)) setFound(result.data!)
    }, 400)
    return () => clearTimeout(timer)
  }, [query])

  const shown = query.trim() ? found : null
  const clear = () => {
    setQuery("")
    setFound(null)
  }

  return (
    <section aria-label="點歌" className="flex flex-col gap-4">
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜尋歌名，或貼上 YouTube、YT Music 的歌曲或歌單連結"
        aria-label="搜尋歌曲"
      />
      {searching && !shown && <p className="text-muted-foreground">搜尋中…</p>}
      {shown && (
        <ul className="flex flex-col">
          {shown.playlist && (
            <PlaylistRow playlist={shown.playlist} onAdded={clear} />
          )}
          {shown.tracks.map((track) => (
            <li
              key={track.videoId}
              className="flex items-center gap-4 border-b border-border py-3"
            >
              <Cover src={track.thumbnail} className="size-12" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{track.title}</span>
                <span className="truncate text-muted-foreground">
                  {[track.artist, length(track.durationS)]
                    .filter(Boolean)
                    .join("，")}
                </span>
              </div>
              <AddButtons videoId={track.videoId} onAdded={clear} />
            </li>
          ))}
          {!shown.tracks.length && (
            <li className="py-3 text-muted-foreground">
              找不到符合「{query.trim()}」的歌
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

const ways = [
  { as: "queue", label: "加入佇列", Icon: ListPlusIcon, done: "已加入佇列" },
  { as: "next", label: "下一首播", Icon: ListStartIcon, done: "排在下一首" },
  { as: "cut_in", label: "插播", Icon: ZapIcon, done: "插播中" },
] as const

/** Queue, play next or cut in one song; onAdded runs after it worked. */
export function AddButtons({
  videoId,
  onAdded = () => {},
}: {
  videoId: string
  onAdded?: () => void
}) {
  const [pending, setPending] = React.useState(false)
  return (
    <div className="flex shrink-0 gap-1">
      {ways.map(({ as, label, Icon, done }) => (
        <Tooltip key={as}>
          <TooltipTrigger
            render={
              <Button
                variant={as === "queue" ? "outline" : "ghost"}
                size="icon"
                aria-label={label}
                disabled={pending}
                onClick={async () => {
                  setPending(true)
                  const result = await add({ videoId, as })
                  setPending(false)
                  if (!ok(result)) return
                  toast.success(result.data!.already ? "已經在佇列裡" : done)
                  onAdded()
                }}
              />
            }
          >
            <Icon />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

function PlaylistRow({
  playlist,
  onAdded,
}: {
  playlist: NonNullable<Found["playlist"]>
  onAdded: () => void
}) {
  const [pending, setPending] = React.useState(false)
  return (
    <li className="flex items-center gap-4 border-b border-border py-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{playlist.title}</span>
        <span className="text-muted-foreground">歌單，{playlist.count} 首</span>
      </div>
      <Button
        disabled={pending}
        onClick={async () => {
          setPending(true)
          const result = await addList({ playlist: playlist.id })
          setPending(false)
          if (!ok(result)) return
          toast.success(`加入 ${result.data!.added} 首`)
          onAdded()
        }}
      >
        {pending ? "加入中…" : "全部加入"}
      </Button>
    </li>
  )
}
