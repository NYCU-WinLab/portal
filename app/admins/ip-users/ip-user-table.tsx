"use client"

import { PencilIcon, Trash2Icon } from "lucide-react"
import * as React from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { IP_USER_CATEGORIES } from "@/lib/ip-users"
import { report } from "@/lib/report"

import { remove, save } from "./actions"

type Entry = {
  id: string
  ip: string
  userName: string
  category: string
  notes: string
  revision: number
}

const categories = Object.entries(IP_USER_CATEGORIES).map(([value, label]) => ({
  value,
  label,
}))
const ALL = "all"

function EntryForm({ entry }: { entry?: Entry }) {
  return (
    <FormDialog
      trigger={
        entry ? (
          <Button variant="ghost" size="icon" aria-label="編輯">
            <PencilIcon />
          </Button>
        ) : (
          <Button>新增 IP</Button>
        )
      }
      title={entry ? entry.ip : "新增 IP"}
      submitLabel="儲存"
      onSubmit={(data) =>
        report(
          save({
            id: entry?.id ?? null,
            expected_revision: entry?.revision ?? null,
            ip: String(data.get("ip") ?? ""),
            user_name: String(data.get("user_name") ?? ""),
            category: String(data.get("category") ?? "unclassified"),
            notes: String(data.get("notes") ?? ""),
          }),
          "已儲存"
        )
      }
    >
      <FormField label="IP" required>
        <Input name="ip" defaultValue={entry?.ip} inputMode="decimal" />
      </FormField>
      <FormField label="使用者">
        <Input
          name="user_name"
          maxLength={200}
          defaultValue={entry?.userName}
        />
      </FormField>
      <FormField label="分類">
        <Select
          name="category"
          defaultValue={entry?.category ?? "unclassified"}
          items={categories}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="備註">
        <Textarea
          name="notes"
          rows={3}
          maxLength={2000}
          defaultValue={entry?.notes}
        />
      </FormField>
    </FormDialog>
  )
}

export function IpUserTable({ entries }: { entries: Entry[] }) {
  const [query, setQuery] = React.useState("")
  const [category, setCategory] = React.useState(ALL)
  const shown = entries.filter(
    (e) =>
      (category === ALL || e.category === category) &&
      `${e.ip} ${e.userName} ${e.notes}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Input
          className="min-w-0 flex-1"
          placeholder="搜尋 IP、使用者或備註"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          value={category}
          onValueChange={(v) => setCategory(String(v))}
          items={[{ value: ALL, label: "全部分類" }, ...categories]}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部分類</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <EntryForm />
      </div>
      <ul className="flex flex-col">
        {shown.map((e) => (
          <li
            key={e.id}
            className="flex min-h-14 items-center gap-4 border-b border-border py-2"
          >
            <span className="w-40 shrink-0 font-mono whitespace-nowrap tabular-nums">
              {e.ip}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{e.userName}</span>
              {e.notes && (
                <span className="truncate text-muted-foreground">
                  {e.notes}
                </span>
              )}
            </span>
            <span className="w-20 shrink-0 text-muted-foreground">
              {IP_USER_CATEGORIES[
                e.category as keyof typeof IP_USER_CATEGORIES
              ] ?? e.category}
            </span>
            <div className="flex shrink-0 gap-1">
              <EntryForm entry={e} />
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon" aria-label="刪除">
                    <Trash2Icon />
                  </Button>
                }
                title={`刪除 ${e.ip}？`}
                confirmLabel="刪除"
                onConfirm={() =>
                  report(
                    remove({ id: e.id, expected_revision: e.revision }),
                    "已刪除"
                  )
                }
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
