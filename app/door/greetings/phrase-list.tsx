"use client"

import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import * as React from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { FormDialog, FormField } from "@/components/form-dialog"
import { SectionHeader } from "@/components/page-header"
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

/** The time slot a new phrase starts in: its group's, or empty for a new one. */
type Slot = Pick<DoorPhrase, "starts_at" | "ends_at" | "days" | "first_visit">

const slotKey = (p: Slot) =>
  p.first_visit ? "first" : `${p.starts_at}-${p.ends_at}-${p.days.join()}`

function PhraseForm({
  phrase,
  slot,
  sample,
  trigger,
}: {
  phrase?: DoorPhrase
  slot?: Slot
  sample: string
  trigger: React.ReactElement
}) {
  const start = phrase ?? slot
  const [days, setDays] = React.useState(start?.days ?? ALL_DAYS)
  const [first, setFirst] = React.useState(start?.first_visit ?? false)
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
      first_visit: first,
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
          setDays(start?.days ?? ALL_DAYS)
          setFirst(start?.first_visit ?? false)
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
            defaultValue={start?.starts_at ?? "22:00"}
          />
        </FormField>
        <FormField label="結束" required>
          <Input
            name="ends_at"
            type="time"
            defaultValue={start?.ends_at ?? "06:00"}
          />
        </FormField>
      </div>
      <Label className="flex items-center justify-between gap-4">
        只在今天第一次進門說，一天從 06:00 算
        <Switch checked={first} onCheckedChange={setFirst} />
      </Label>
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

function PhraseRow({ phrase, sample }: { phrase: DoorPhrase; sample: string }) {
  return (
    <li className="flex min-h-14 items-center gap-4 border-b border-border py-2">
      <span className="min-w-0 flex-1 truncate">
        {phrase.before}
        {sample}
        {phrase.after || "。"}
      </span>
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
    </li>
  )
}

// The pool, one group per time slot: phrases with the same time and days,
// and the first-visit ones on their own, first. The door picks one phrase
// of the slot in force at random; a group in force carries a badge.
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
  const groups = new Map<string, DoorPhrase[]>()
  for (const phrase of phrases)
    groups.set(slotKey(phrase), [
      ...(groups.get(slotKey(phrase)) ?? []),
      phrase,
    ])
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    a === "first" ? -1 : b === "first" ? 1 : a.localeCompare(b)
  )
  return (
    <div className="flex stagger-rise flex-col gap-10">
      {ordered.map(([key, group]) => {
        const slot = group[0]
        const title = slot.first_visit
          ? "今天第一次進門"
          : `${slot.starts_at} 到 ${slot.ends_at}，${dayLabel(slot.days)}`
        return (
          <section key={key} className="flex flex-col gap-2">
            <SectionHeader
              title={title}
              actions={
                <div className="flex items-center gap-2">
                  {group.some((p) => now.includes(p.id)) && (
                    <Badge variant="muted">現在</Badge>
                  )}
                  <PhraseForm
                    slot={slot}
                    sample={sample}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label="加一句">
                        <PlusIcon />
                      </Button>
                    }
                  />
                </div>
              }
            />
            <ul className="flex flex-col">
              {group.map((phrase) => (
                <PhraseRow key={phrase.id} phrase={phrase} sample={sample} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
