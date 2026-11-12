"use client"

import { PencilIcon, Trash2Icon } from "lucide-react"
import * as React from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Toggle } from "@/components/ui/toggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { DoorSoundRule } from "@/lib/actions/door-sound-rules"
import { report } from "@/lib/report"

import { dayLabel } from "../greetings/phrase-list"
import { create, remove, update } from "./actions"

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]
const text = (data: FormData, key: string) => String(data.get(key) ?? "")

type Sound = { id: string; label: string }

// A row of toggle buttons: the weekdays, or the pool sounds a rule picks.
function Toggles<T extends string | number>({
  label,
  items,
  value,
  onChange,
}: {
  label: string
  items: { value: T; label: string }[]
  value: T[]
  onChange: (next: T[]) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {items.map((item) => {
          const on = value.includes(item.value)
          return (
            <Toggle
              key={item.value}
              size={typeof item.value === "number" ? "icon" : "text"}
              pressed={on}
              onPressedChange={() =>
                onChange(
                  on
                    ? value.filter((v) => v !== item.value)
                    : items
                        .map((i) => i.value)
                        .filter((v) => v === item.value || value.includes(v))
                )
              }
            >
              {item.label}
            </Toggle>
          )
        })}
      </div>
    </div>
  )
}

function RuleForm({
  rule,
  sounds,
  trigger,
}: {
  rule?: DoorSoundRule
  sounds: Sound[]
  trigger: React.ReactElement
}) {
  const [days, setDays] = React.useState(rule?.days ?? ALL_DAYS)
  const [picked, setPicked] = React.useState(
    rule?.sounds.map((s) => s.id) ?? []
  )

  async function submit(data: FormData) {
    const input = {
      starts_at: text(data, "starts_at"),
      ends_at: text(data, "ends_at"),
      days,
      sound_ids: picked,
      enabled: rule?.enabled ?? true,
    }
    await report(
      rule ? update({ ...input, id: rule.id }) : create(input),
      rule ? "已儲存" : "已新增"
    )
  }

  return (
    <FormDialog
      trigger={trigger}
      size="wide"
      onOpenChange={(open) => {
        if (open) {
          setDays(rule?.days ?? ALL_DAYS)
          setPicked(rule?.sounds.map((s) => s.id) ?? [])
        }
      }}
      title={rule ? "修改排程" : "新增排程"}
      submitLabel={rule ? "儲存" : "新增"}
      onSubmit={submit}
    >
      <div className="grid grid-cols-2 gap-4">
        <FormField label="開始" required>
          <Input
            name="starts_at"
            type="time"
            defaultValue={rule?.starts_at ?? "08:00"}
          />
        </FormField>
        <FormField label="結束" required>
          <Input
            name="ends_at"
            type="time"
            defaultValue={rule?.ends_at ?? "12:00"}
          />
        </FormField>
      </div>
      <Toggles
        label="星期，以開始那天算"
        items={ALL_DAYS.map((day) => ({
          value: day,
          label: WEEKDAYS[day - 1],
        }))}
        value={days}
        onChange={setDays}
      />
      <Toggles
        label="音效，隨機播一個"
        items={sounds.map((s) => ({ value: s.id, label: s.label }))}
        value={picked}
        onChange={setPicked}
      />
    </FormDialog>
  )
}

export function AddRule({ sounds }: { sounds: Sound[] }) {
  return <RuleForm sounds={sounds} trigger={<Button>新增</Button>} />
}

function RuleRow({
  rule,
  active,
  sounds,
  editable,
}: {
  rule: DoorSoundRule
  active: boolean
  sounds: Sound[]
  editable: boolean
}) {
  return (
    <li className="flex min-h-14 items-center gap-4 border-b border-border py-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate tabular-nums">
          {`${rule.starts_at} 到 ${rule.ends_at}，${dayLabel(rule.days)}`}
        </span>
        <span className="truncate text-muted-foreground">
          {rule.sounds.length
            ? rule.sounds.map((s) => s.label).join("、")
            : "音效都被刪掉了，這段時間播預設音效"}
        </span>
      </div>
      {active && <Badge variant="success">生效中</Badge>}
      {!rule.enabled && <Badge variant="muted">停用</Badge>}
      {editable && (
        <>
          <Label className="flex shrink-0 items-center gap-2 text-muted-foreground">
            啟用
            <Switch
              checked={rule.enabled}
              onCheckedChange={(enabled) =>
                report(
                  update({
                    id: rule.id,
                    starts_at: rule.starts_at,
                    ends_at: rule.ends_at,
                    days: rule.days,
                    sound_ids: rule.sounds.map((s) => s.id),
                    enabled,
                  }),
                  enabled ? "已啟用" : "已停用"
                ).catch(() => {})
              }
            />
          </Label>
          <div className="flex shrink-0 gap-1">
            <RuleForm
              rule={rule}
              sounds={sounds}
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
              title="刪除這條排程？"
              confirmLabel="刪除"
              variant="destructive"
              onConfirm={() => report(remove(rule.id), "已刪除")}
            />
          </div>
        </>
      )}
    </li>
  )
}

export function RuleList({
  rules,
  now,
  sounds,
  editable,
}: {
  rules: DoorSoundRule[]
  now: string[]
  sounds: Sound[]
  editable: boolean
}) {
  if (!rules.length) return <EmptyState noun="排程" />
  const active = new Set(now)
  return (
    <ul className="flex stagger-rise flex-col">
      {rules.map((rule) => (
        <RuleRow
          key={rule.id}
          rule={rule}
          active={active.has(rule.id)}
          sounds={sounds}
          editable={editable}
        />
      ))}
    </ul>
  )
}
