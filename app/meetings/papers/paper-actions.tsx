"use client"

import { PencilIcon, Trash2Icon } from "lucide-react"
import * as React from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import {
  paperAdd,
  paperDelete,
  paperUpdate,
  tagAdd,
  tagDelete,
  tagRename,
} from "../actions"
import { report } from "@/lib/report"

export type Tag = { id: string; name: string; papers?: number }
export type Paper = {
  id: string
  title: string
  url: string | null
  venue: string | null
  tags: Tag[]
  uses: { date: string; presenter: string | null; past: boolean }[]
}

const read = (data: FormData) => ({
  title: String(data.get("title") ?? ""),
  url: String(data.get("url") ?? ""),
  venue: String(data.get("venue") ?? ""),
})

function IconAction({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon" aria-label={label} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function TagPicker({
  tags,
  value,
  onChange,
}: {
  tags: Tag[]
  value: string[]
  onChange: (ids: string[]) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>標籤</Label>
      <div role="group" aria-label="標籤" className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const on = value.includes(tag.id)
          return (
            <Button
              key={tag.id}
              type="button"
              variant={on ? "default" : "outline"}
              aria-pressed={on}
              onClick={() =>
                onChange(
                  on ? value.filter((id) => id !== tag.id) : [...value, tag.id]
                )
              }
            >
              {tag.name}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

export function PaperDialog({ paper, tags }: { paper?: Paper; tags: Tag[] }) {
  const [tagIds, setTagIds] = React.useState(
    paper?.tags.map((tag) => tag.id) ?? []
  )
  return (
    <FormDialog
      trigger={
        paper ? (
          <IconAction label="編輯">
            <PencilIcon />
          </IconAction>
        ) : (
          <Button>新增</Button>
        )
      }
      title={paper ? "編輯論文" : "新增論文"}
      size="wide"
      submitLabel={paper ? "儲存" : "新增"}
      onSubmit={async (data) => {
        if (paper)
          await report(
            paperUpdate({ id: paper.id, ...read(data), tagIds }),
            "已儲存"
          )
        else {
          await report(paperAdd({ ...read(data), tagIds }), "已新增")
          setTagIds([])
        }
      }}
    >
      <FormField label="標題" required>
        <Input name="title" defaultValue={paper?.title} maxLength={300} />
      </FormField>
      <FormField label="連結">
        <Input name="url" type="url" defaultValue={paper?.url ?? ""} />
      </FormField>
      <FormField label="出處">
        <Input
          name="venue"
          defaultValue={paper?.venue ?? ""}
          placeholder="NSDI'24"
          maxLength={50}
        />
      </FormField>
      {tags.length > 0 && (
        <TagPicker tags={tags} value={tagIds} onChange={setTagIds} />
      )}
    </FormDialog>
  )
}

export function PaperRowActions({
  paper,
  tags,
}: {
  paper: Paper
  tags: Tag[]
}) {
  return (
    <div className="flex shrink-0 gap-1">
      <PaperDialog paper={paper} tags={tags} />
      <ConfirmDialog
        trigger={
          <IconAction label="刪除">
            <Trash2Icon />
          </IconAction>
        }
        title={`刪除「${paper.title}」？`}
        confirmLabel="刪除"
        onConfirm={() => report(paperDelete({ id: paper.id }), "已刪除")}
      />
    </div>
  )
}

// Admins add, rename and delete tags in one place.
export function TagsDialog({ tags }: { tags: Tag[] }) {
  return (
    <FormDialog
      trigger={<Button variant="outline">標籤</Button>}
      title="論文標籤"
      submitLabel="新增"
      onSubmit={(data) =>
        report(tagAdd({ name: String(data.get("name") ?? "") }), "已新增")
      }
    >
      <ul className="flex flex-col">
        {tags.map((tag) => (
          <TagRow key={tag.id} tag={tag} />
        ))}
      </ul>
      <FormField label="新標籤">
        <Input name="name" maxLength={30} />
      </FormField>
    </FormDialog>
  )
}

function TagRow({ tag }: { tag: Tag }) {
  const [name, setName] = React.useState(tag.name)
  const [pending, startTransition] = React.useTransition()
  const rename = () =>
    name.trim() &&
    name.trim() !== tag.name &&
    startTransition(async () => {
      await report(tagRename({ id: tag.id, name }), "已重新命名").catch(() =>
        setName(tag.name)
      )
    })
  return (
    <li className="flex items-center gap-2 border-b border-border py-2">
      <Input
        aria-label={`${tag.name} 的名稱`}
        value={name}
        disabled={pending}
        maxLength={30}
        onChange={(event) => setName(event.target.value)}
        onBlur={rename}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            rename()
          }
        }}
      />
      <span className="w-16 shrink-0 text-right text-muted-foreground tabular-nums">
        {tag.papers ?? 0} 篇
      </span>
      <ConfirmDialog
        trigger={
          <IconAction label="刪除">
            <Trash2Icon />
          </IconAction>
        }
        title={`刪除標籤「${tag.name}」？論文會保留`}
        confirmLabel="刪除"
        onConfirm={() => report(tagDelete({ id: tag.id }), "已刪除")}
      />
    </li>
  )
}
