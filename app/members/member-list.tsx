"use client"

import * as React from "react"

import { EmptyState } from "@/components/empty-state"
import { SectionHeader } from "@/components/page-header"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { MemberStatus } from "@/lib/actions/members"

type Member = {
  id: string
  name: string
  name_en: string
  username: string
  email: string | null
  phone: string | null
  student_id: string | null
  status: MemberStatus
  cohort: number | null
  title: string | null
}

const statusLabel: Record<MemberStatus, string> = {
  teacher: "老師",
  assistant: "助理",
  doctoral: "博士",
  master: "碩士",
  undergrad: "大學部",
  alumni: "已畢業",
  other: "其他",
}
const CURRENT = "current"
const ALL = "all"
const filters = [
  { value: CURRENT, label: "在學與在職" },
  { value: ALL, label: "全部" },
  ...Object.entries(statusLabel).map(([value, label]) => ({ value, label })),
]

// The directory the lab used to keep on www.winlab.tw/directory: search
// across every field, one section per status. Alumni stay out of the
// default view; they are most of the list.
export function MemberList({ members }: { members: Member[] }) {
  const [query, setQuery] = React.useState("")
  const [filter, setFilter] = React.useState(CURRENT)
  const q = query.trim().toLowerCase()
  const shown = members.filter(
    (m) =>
      (filter === ALL ||
        (filter === CURRENT ? m.status !== "alumni" : m.status === filter)) &&
      [m.name, m.name_en, m.username, m.email, m.phone, m.student_id, m.title]
        .join(" ")
        .toLowerCase()
        .includes(q)
  )
  const sections = (Object.keys(statusLabel) as MemberStatus[])
    .map((status) => ({
      status,
      members: shown.filter((m) => m.status === status),
    }))
    .filter((section) => section.members.length > 0)

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-2">
        <Input
          className="min-w-0 flex-1"
          placeholder="搜尋姓名、Email、電話或學號"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          value={filter}
          onValueChange={(v) => setFilter(String(v))}
          items={filters}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {filters.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {sections.length === 0 ? (
        <EmptyState
          noun="成員"
          query={query.trim() || undefined}
          onClearQuery={() => setQuery("")}
        />
      ) : (
        sections.map((section) => (
          <section key={section.status} className="flex flex-col gap-2">
            <SectionHeader
              title={`${statusLabel[section.status]} ${section.members.length}`}
            />
            <ul className="flex flex-col">
              {section.members.map((m) => (
                <li
                  key={m.id}
                  className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border py-2"
                >
                  <span className="flex min-w-40 flex-1 flex-col">
                    <span className="truncate">
                      {m.name}
                      {m.title && (
                        <span className="ml-2 text-muted-foreground">
                          {m.title}
                        </span>
                      )}
                    </span>
                    {m.name_en && (
                      <span className="truncate text-muted-foreground">
                        {m.name_en}
                      </span>
                    )}
                  </span>
                  {m.email && (
                    <a
                      href={`mailto:${m.email}`}
                      className="min-w-0 truncate text-muted-foreground hover:text-foreground sm:w-64"
                    >
                      {m.email}
                    </a>
                  )}
                  <span className="w-32 shrink-0 text-muted-foreground tabular-nums">
                    {m.phone ? (
                      <a
                        href={`tel:${m.phone}`}
                        className="hover:text-foreground"
                      >
                        {m.phone}
                      </a>
                    ) : null}
                  </span>
                  <span className="hidden w-28 shrink-0 font-mono text-muted-foreground tabular-nums md:block">
                    {m.student_id}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
