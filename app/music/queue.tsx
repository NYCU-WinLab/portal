"use client"

import { EllipsisIcon } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { SectionHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { listQueue } from "@/lib/actions/music"

import { add, next, remove } from "./actions"
import { ok } from "./ok"
import { addedAsLabel, addedLine, Cover, length } from "./song"

type Item = Awaited<ReturnType<typeof listQueue.run>>["items"][number]

// What plays next, in order, with who added each song.
export function Queue({ items }: { items: Item[] }) {
  return (
    <section aria-label="接下來" className="flex flex-col gap-4">
      <SectionHeader title={`接下來 ${items.length ? items.length : ""}`} />
      {items.length ? (
        <ol className="flex flex-col">
          {items.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </ol>
      ) : (
        <EmptyState noun="排隊的歌" />
      )}
    </section>
  )
}

function Row({ item }: { item: Item }) {
  return (
    <li className="flex items-center gap-4 border-b border-border py-3">
      <Cover src={item.track.thumbnail} className="size-12" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{item.track.title}</span>
        <span className="truncate text-muted-foreground">
          {[item.track.artist, length(item.track.durationS)]
            .filter(Boolean)
            .join("，")}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
          {item.addedAs !== "queue" && item.addedAs !== "auto" && (
            <Badge variant="muted">{addedAsLabel[item.addedAs]}</Badge>
          )}
          <span>{addedLine(item)}</span>
        </span>
      </div>
      <div className="flex shrink-0 gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" aria-label="更多" />}
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={async () => ok(await next({ itemId: item.id }))}
            >
              下一首播
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () =>
                ok(await add({ videoId: item.track.videoId, as: "cut_in" }))
              }
            >
              插播
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => ok(await remove({ itemId: item.id }))}
            >
              移出佇列
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}
