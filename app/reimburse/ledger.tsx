"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { EmptyState } from "@/components/empty-state"
import type { Member } from "@/components/member-combobox"
import { SectionHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { LedgerEntry } from "@/lib/actions/reimburse"
import { dateLabel } from "@/lib/leave-dates"

import { EntryActions } from "./entry-forms"

const filters = [
  { key: "all", label: "全部" },
  { key: "egress", label: "支出" },
  { key: "ingress", label: "收入" },
  { key: "owed", label: "未轉帳" },
] as const

type Filter = (typeof filters)[number]["key"]

const signed = (entry: LedgerEntry) =>
  `${entry.kind === "egress" ? "−" : "+"}${entry.amount.toLocaleString("en-US")}`

// "2026-09" → "2026 年 9 月"
const monthLabel = (month: string) =>
  `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`

// The ledger by month, newest first, filtered on the page.
export function Ledger({
  entries,
  admin,
  members,
  today,
}: {
  entries: LedgerEntry[]
  admin: boolean
  members: Member[]
  today: string
}) {
  // Kept in the URL (?filter=owed) so a refresh after a change keeps it.
  const router = useRouter()
  const pathname = usePathname()
  const param = useSearchParams().get("filter")
  const filter: Filter =
    filters.find((option) => option.key === param)?.key ?? "all"
  const setFilter = (next: Filter) =>
    router.replace(next === "all" ? pathname : `${pathname}?filter=${next}`, {
      scroll: false,
    })
  const shown = entries.filter((entry) =>
    filter === "all"
      ? true
      : filter === "owed"
        ? entry.kind === "egress" && entry.transferDate === null
        : entry.kind === filter
  )
  const months = new Map<string, LedgerEntry[]>()
  for (const entry of shown) {
    const key = entry.date.slice(0, 7)
    months.set(key, [...(months.get(key) ?? []), entry])
  }

  return (
    <div className="flex flex-col gap-12">
      <div role="group" aria-label="篩選" className="flex flex-wrap gap-2">
        {filters.map((option) => (
          <Button
            key={option.key}
            variant={filter === option.key ? "default" : "outline"}
            aria-pressed={filter === option.key}
            onClick={() => setFilter(option.key)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState noun={filter === "owed" ? "未轉帳的支出" : "紀錄"} />
      ) : (
        [...months].map(([month, rows]) => (
          <section key={`${filter}-${month}`} className="flex flex-col gap-2">
            <SectionHeader title={monthLabel(month)} />
            <ul className="flex stagger-rise flex-col">
              {rows.map((entry) => (
                <li
                  key={entry.id}
                  className="flex min-h-14 items-center gap-4 border-b border-border py-2"
                >
                  <span className="w-12 shrink-0 text-muted-foreground tabular-nums">
                    {dateLabel(entry.date)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    {entry.kind === "egress" ? (
                      <>
                        <span className="truncate">
                          <span className="font-medium">{entry.applicant}</span>{" "}
                          {entry.item}
                        </span>
                        <span className="text-muted-foreground">
                          {entry.transferDate ? (
                            `${dateLabel(entry.transferDate)} 轉帳${entry.transferFee ? `，手續費 ${entry.transferFee}` : ""}`
                          ) : (
                            <Badge variant="warning">未轉帳</Badge>
                          )}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-medium">收入</span>
                        {entry.note && (
                          <span className="truncate text-muted-foreground">
                            {entry.note}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">{signed(entry)}</span>
                  {admin && (
                    <EntryActions
                      entry={entry}
                      members={members}
                      today={today}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
