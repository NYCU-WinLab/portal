"use client"

import { PencilIcon, Trash2Icon } from "lucide-react"
import * as React from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { DoorPhrase } from "@/lib/actions/door-phrases"
import { report } from "@/lib/report"

import { create, remove, update } from "./actions"

// Kept here: lib/door-greeting imports node:crypto, which a client component must not pull in.
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]
const text = (data: FormData, key: string) => String(data.get(key) ?? "")

export const dayLabel = (days: number[]) =>
  days.length === 7
    ? "每天"
    : days.join() === "1,2,3,4,5"
      ? "週一到週五"
      : days.join() === "6,7"
        ? "週末"
        : `週${days.map((day) => WEEKDAYS[day - 1]).join("、")}`

function PhraseForm({
  phrase,
  sample,
  trigger,
}: {
  phrase?: DoorPhrase
  sample: string
  trigger: React.ReactElement
}) {
  const [days, setDays] = React.useState(phrase?.days ?? ALL_DAYS)
  const [before, setBefore] = React.useState(phrase?.before ?? "")
  const [after, setAfter] = React.useState(phrase?.after ?? "")

  async function submit(data: FormData) {
    const input = {
      before: text(data, "before"),
      after: text(data, "after"),
      starts_at: text(data, "starts_at"),
      ends_at: text(data, "ends_at"),
      days,
      enabled: phrase?.enabled ?? true,
    }
    await report(
      phrase ? update({ ...input, id: phrase.id }) : create(input),
      phrase ? "已儲存" : "已新增"
    )
  }

  return (
    <FormDialog
      trigger={trigger}
      onOpenChange={(open) => {
        if (open) {
          setDays(phrase?.days ?? ALL_DAYS)
          setBefore(phrase?.before ?? "")
          setAfter(phrase?.after ?? "")
        }
      }}
      title={phrase ? "修改問候語" : "新增問候語"}
      submitLabel={phrase ? "儲存" : "新增"}
      onSubmit={submit}
    >
      <FormField label="名字前">
        <Input
          name="before"
          maxLength={40}
          placeholder="晚安，"
          value={before}
          onChange={(event) => setBefore(event.target.value)}
        />
      </FormField>
      <FormField label="名字後">
        <Input
          name="after"
          maxLength={40}
          placeholder="這麼晚來，很認真喔。"
          value={after}
          onChange={(event) => setAfter(event.target.value)}
        />
      </FormField>
      <p className="text-muted-foreground">
        {before}
        {sample}
        {after || "。"}
      </p>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="開始" required>
          <Input
            name="starts_at"
            type="time"
            defaultValue={phrase?.starts_at ?? "22:00"}
          />
        </FormField>
        <FormField label="結束" required>
          <Input
            name="ends_at"
            type="time"
            defaultValue={phrase?.ends_at ?? "06:00"}
          />
        </FormField>
      </div>
      <div className="flex flex-col gap-2">
        <Label>星期，以開始那天算</Label>
        <div role="group" aria-label="星期" className="flex flex-wrap gap-2">
          {ALL_DAYS.map((day) => {
            const on = days.includes(day)
            return (
              <Button
                key={day}
                type="button"
                size="icon"
                variant={on ? "default" : "outline"}
                aria-pressed={on}
                onClick={() =>
                  setDays(
                    on
                      ? days.filter((d) => d !== day)
                      : [...days, day].sort((a, b) => a - b)
                  )
                }
              >
                {WEEKDAYS[day - 1]}
              </Button>
            )
          })}
        </div>
      </div>
    </FormDialog>
  )
}

export function AddPhrase({ sample }: { sample: string }) {
  return <PhraseForm sample={sample} trigger={<Button>新增</Button>} />
}

// The pool, by start time. A phrase in force right now carries a badge;
// the door picks one of those at random at each opening.
export function PhraseList({
  phrases,
  now,
  sample,
}: {
  phrases: DoorPhrase[]
  now: string[]
  sample: string
}) {
  if (phrases.length === 0) return <EmptyState noun="問候語" />
  return (
    <ul className="flex stagger-rise flex-col">
      {phrases.map((phrase) => (
        <li
          key={phrase.id}
          className="flex min-h-14 items-center gap-4 border-b border-border py-2"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">
              {phrase.before}
              {sample}
              {phrase.after || "。"}
            </span>
            <span className="truncate text-muted-foreground">
              {`${phrase.starts_at} 到 ${phrase.ends_at}，${dayLabel(phrase.days)}`}
            </span>
          </span>
          {now.includes(phrase.id) && <Badge variant="muted">現在</Badge>}
          <>
            <Label className="flex shrink-0 items-center gap-2 text-muted-foreground">
              啟用
              <Switch
                checked={phrase.enabled}
                onCheckedChange={(enabled) =>
                  report(
                    update({ ...phrase, enabled }),
                    enabled ? "已啟用" : "已停用"
                  ).catch(() => {})
                }
              />
            </Label>
            <div className="flex shrink-0 gap-1">
              <PhraseForm
                phrase={phrase}
                sample={sample}
                trigger={
                  <Button variant="ghost" size="icon" aria-label="修改">
                    <PencilIcon />
                  </Button>
                }
              />
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon" aria-label="刪除">
                    <Trash2Icon />
                  </Button>
                }
                title="刪除這條問候語？"
                confirmLabel="刪除"
                variant="destructive"
                onConfirm={() => report(remove(phrase.id), "已刪除")}
              />
            </div>
          </>
        </li>
      ))}
    </ul>
  )
}
