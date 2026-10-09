"use client"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { add, fill, generate, swap } from "./actions"
import { report } from "./report"

type Option = { value: string; label: string }

const value = (data: FormData, key: string) =>
  String(data.get(key) ?? "").trim()

function DateSelect({
  name,
  label,
  dates,
}: {
  name: string
  label: string
  dates: Option[]
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`swap-${name}`}>{label}</Label>
      <Select name={name} required items={dates}>
        <SelectTrigger id={`swap-${name}`} className="w-full">
          <SelectValue placeholder="選擇一週" />
        </SelectTrigger>
        <SelectContent>
          {dates.map((date) => (
            <SelectItem key={date.value} value={date.value}>
              {date.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// "2026-10-10 國慶日" per line → holidays.
function parseHolidays(lines: string) {
  return lines
    .split(/[,，\n]/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [date, ...reason] = line.split(/\s+/)
      return { date, reason: reason.join(" ") }
    })
}

export function AdminActions({ dates }: { dates: Option[] }) {
  return (
    <>
      <FormDialog
        trigger={<Button variant="outline">產生學期</Button>}
        title="產生學期"
        submitLabel="產生"
        onSubmit={(data) =>
          report(
            generate({
              start: value(data, "start"),
              weeks: Number(value(data, "weeks")),
              holidays: parseHolidays(value(data, "holidays")),
            }),
            "已產生"
          )
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="第 1 週" required>
            <Input name="start" type="date" />
          </FormField>
          <FormField label="週數" required>
            <Input
              name="weeks"
              type="number"
              min={1}
              max={30}
              defaultValue={16}
            />
          </FormField>
        </div>
        <FormField label="放假（日期 原因，多週用逗號分隔）">
          <Input name="holidays" placeholder="2026-10-12 國慶日補假" />
        </FormField>
      </FormDialog>
      <FormDialog
        trigger={<Button variant="outline">新增一週</Button>}
        title="新增一週"
        submitLabel="新增"
        onSubmit={(data) =>
          report(add({ date: value(data, "date") }), "已新增")
        }
      >
        <FormField label="日期" required>
          <Input name="date" type="date" />
        </FormField>
      </FormDialog>
      <FormDialog
        trigger={<Button variant="outline">交換</Button>}
        title="交換兩週"
        submitLabel="交換"
        onSubmit={(data) =>
          report(
            swap({
              first: value(data, "first"),
              second: value(data, "second"),
            }),
            "已交換"
          )
        }
      >
        <DateSelect name="first" label="這一週" dates={dates} />
        <DateSelect name="second" label="換到" dates={dates} />
      </FormDialog>
      <ConfirmDialog
        trigger={<Button>自動排報告人</Button>}
        title="依報告順序填入所有還沒排的週？"
        confirmLabel="排入"
        variant="default"
        onConfirm={() => report(fill(), "已排入")}
      />
    </>
  )
}
