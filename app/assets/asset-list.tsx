"use client"

import * as React from "react"

import { EmptyState } from "@/components/empty-state"
import { ExpandRow } from "@/components/expand-row"
import { FieldList, FieldRow } from "@/components/field-list"
import { Input } from "@/components/ui/input"
import type { Asset } from "@/lib/assetweb"
import { ntd } from "@/lib/money"

// The property the lab keeps, as NYCU's property system lists it: search
// across every field, newest first. Locations are free text there, so
// they stay as typed.
export function AssetList({ assets }: { assets: Asset[] }) {
  const [query, setQuery] = React.useState("")
  const q = query.trim().toLowerCase()
  const shown = assets
    .filter((a) =>
      [a.id, a.no, a.name, a.alias, a.brand, a.model, a.user, a.location]
        .join(" ")
        .toLowerCase()
        .includes(q)
    )
    .sort(
      (a, b) =>
        (b.acquiredOn ?? "").localeCompare(a.acquiredOn ?? "") ||
        a.id.localeCompare(b.id) ||
        a.no.localeCompare(b.no)
    )

  return (
    <div className="flex flex-col gap-8">
      <Input
        placeholder="搜尋名稱、廠牌、型式、地點或財產編號"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {shown.length === 0 ? (
        <EmptyState
          noun="財產"
          query={query.trim() || undefined}
          onClearQuery={() => setQuery("")}
        />
      ) : (
        <ul className="flex flex-col">
          {shown.map((a) => (
            <ExpandRow
              key={`${a.id}/${a.no}`}
              summary={
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="flex min-w-40 flex-1 flex-col">
                    <span className="truncate">{a.alias || a.name}</span>
                    <span className="truncate text-muted-foreground">
                      {[a.brand, a.model].filter(Boolean).join(" ")}
                    </span>
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground sm:w-48">
                    {a.location}
                  </span>
                  <span className="w-28 shrink-0 text-right text-muted-foreground tabular-nums">
                    {ntd(a.cost)}
                  </span>
                </span>
              }
            >
              <FieldList>
                <FieldRow label="財產編號">
                  <span className="font-mono tabular-nums">
                    {a.id} / {a.no}
                  </span>
                </FieldRow>
                <FieldRow label="名稱">
                  {a.name}
                  {a.alias && a.alias !== a.name && `（${a.alias}）`}
                </FieldRow>
                <FieldRow label="數量">
                  {a.quantity} {a.unit}
                </FieldRow>
                <FieldRow label="取得日期">
                  <span className="tabular-nums">{a.acquiredOn}</span>
                </FieldRow>
                <FieldRow label="帳面價值">
                  <span className="tabular-nums">{ntd(a.bookValue)}</span>
                </FieldRow>
                <FieldRow label="使用年限">{a.usefulYears} 年</FieldRow>
                <FieldRow label="保管人">{a.keeper}</FieldRow>
                <FieldRow label="使用人">{a.user}</FieldRow>
                {a.note && <FieldRow label="保管摘要">{a.note}</FieldRow>}
              </FieldList>
            </ExpandRow>
          ))}
        </ul>
      )}
    </div>
  )
}
