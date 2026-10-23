"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Receipt } from "@/lib/actions/receipts"
import { depositAccounts, receiptStatuses } from "@/lib/receipts"

import { ReceiptActions } from "./receipt-forms"

// The value the project select uses for "every project".
const ALL = "__all__"

const statusFilters = [
  { key: "all", label: "全部" },
  { key: "pending", label: "審核中" },
  { key: "approved", label: "完成" },
] as const

const day = (date: Date) =>
  date.toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  })

// Every receipt, filtered on the page by status and project; the filters
// live in the URL (?status=pending&project=國科會) so a refresh keeps them.
export function ReceiptList({
  receipts,
  projects,
}: {
  receipts: Receipt[]
  projects: string[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const status = params.get("status") ?? "all"
  const project = params.get("project")
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }
  const shown = receipts.filter(
    (receipt) =>
      (status === "all" || receipt.status === status) &&
      (!project || receipt.project === project)
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="狀態" className="flex flex-wrap gap-2">
          {statusFilters.map((option) => (
            <Button
              key={option.key}
              variant={status === option.key ? "default" : "outline"}
              aria-pressed={status === option.key}
              onClick={() =>
                set("status", option.key === "all" ? null : option.key)
              }
            >
              {option.label}
            </Button>
          ))}
        </div>
        {projects.length > 0 && (
          <Select
            value={project ?? ALL}
            onValueChange={(value) =>
              set("project", value === ALL ? null : String(value))
            }
            items={[
              { value: ALL, label: "所有計畫" },
              ...projects.map((name) => ({ value: name, label: name })),
            ]}
          >
            <SelectTrigger aria-label="計畫" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>所有計畫</SelectItem>
              {projects.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {shown.length === 0 ? (
        <EmptyState noun="收據" />
      ) : (
        <ul key={`${status}-${project}`} className="flex stagger-rise flex-col">
          {shown.map((receipt) => (
            <li
              key={receipt.id}
              className="flex min-h-14 items-center gap-4 border-b border-border py-3"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <a
                  href={`/receipts/files/${receipt.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate underline-offset-4 hover:underline"
                >
                  {receipt.name}
                </a>
                <span className="truncate text-muted-foreground">
                  {[
                    receipt.project,
                    receipt.depositAccount &&
                      depositAccounts[receipt.depositAccount],
                    receipt.uploader,
                    day(receipt.createdAt),
                  ]
                    .filter(Boolean)
                    .join("，")}
                </span>
              </span>
              {receipt.status === "approved" && (
                <Badge variant="muted">{receiptStatuses.approved}</Badge>
              )}
              <div className="flex shrink-0 gap-1">
                <ReceiptActions receipt={receipt} projects={projects} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
