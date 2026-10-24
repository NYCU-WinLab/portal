"use client"

import * as React from "react"

import { toast } from "sonner"

import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { dateLabel } from "@/lib/leave-dates"

import { showPresented as saveShowPresented } from "../actions"
import { type Paper, PaperRowActions, type Tag } from "./paper-actions"

// The paper list, filtered by tag on the page: pick one or more tags to see
// the papers carrying any of them. Papers already presented are hidden
// unless the member switches them on, a choice saved with their account.
// Each paper says who presented it or has it lined up.
export function PaperList({
  papers,
  tags,
  admin,
  showPresented,
}: {
  papers: Paper[]
  tags: Tag[]
  admin: boolean
  showPresented: boolean
}) {
  const [picked, setPicked] = React.useState<string[]>([])
  const [withPresented, setWithPresented] = React.useState(showPresented)
  const shown = papers.filter(
    (paper) =>
      (picked.length === 0 ||
        paper.tags.some((tag) => picked.includes(tag.id))) &&
      (withPresented || !paper.uses.some((use) => use.past))
  )
  const switchPresented = async (on: boolean) => {
    setWithPresented(on)
    const { error } = await saveShowPresented({ show: on })
    if (error) {
      toast.error(error)
      setWithPresented(!on)
    }
  }
  const toggle = (id: string) =>
    setPicked((ids) =>
      ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]
    )

  return (
    <div className="flex flex-col gap-6">
      <label className="flex items-center gap-3">
        <Switch checked={withPresented} onCheckedChange={switchPresented} />
        顯示報告過的論文
      </label>
      {tags.length > 0 && (
        <div
          role="group"
          aria-label="依標籤篩選"
          className="flex flex-wrap gap-2"
        >
          {tags.map((tag) => (
            <Button
              key={tag.id}
              variant={picked.includes(tag.id) ? "default" : "outline"}
              aria-pressed={picked.includes(tag.id)}
              onClick={() => toggle(tag.id)}
            >
              {tag.name}
            </Button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState noun="論文" />
      ) : (
        <ul
          key={`${picked.join()}:${withPresented}`}
          className="flex stagger-rise flex-col"
        >
          {shown.map((paper) => (
            <li
              key={paper.id}
              className="flex min-h-14 flex-col gap-1 border-b border-border py-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {paper.url ? (
                  <a
                    href={paper.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline-offset-4 hover:underline"
                  >
                    {paper.title}
                  </a>
                ) : (
                  <span>{paper.title}</span>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                  {paper.venue && <span>{paper.venue}</span>}
                  {paper.tags.map((tag) => (
                    <Badge key={tag.id} variant="outline">
                      {tag.name}
                    </Badge>
                  ))}
                  {paper.uses.map((use) => (
                    <span key={use.date}>
                      {use.presenter ?? "未排"} {use.date.slice(0, 4)}/
                      {dateLabel(use.date)} {use.past ? "報告過" : "已選"}
                    </span>
                  ))}
                </div>
              </div>
              {admin && <PaperRowActions paper={paper} tags={tags} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
