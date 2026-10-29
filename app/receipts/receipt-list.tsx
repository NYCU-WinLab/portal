"use client"

import { ArrowUpRightIcon } from "lucide-react"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Receipt } from "@/lib/actions/receipts"
import { depositAccounts, receiptStatuses } from "@/lib/receipts"
import { report } from "@/lib/report"

import { edit } from "./actions"
import { ProjectCombobox } from "./project-combobox"
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名稱</TableHead>
              <TableHead>計畫</TableHead>
              <TableHead>帳戶</TableHead>
              <TableHead>上傳者</TableHead>
              <TableHead>日期</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>
                <span className="sr-only">操作</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody key={`${status}-${project}`} className="stagger-rise">
            {shown.map((receipt) => (
              <TableRow key={receipt.id}>
                <TableCell className="max-w-80 truncate">
                  <a
                    href={`/receipts/files/${receipt.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-current/40 underline-offset-4 hover:decoration-current"
                  >
                    {receipt.name}
                    <ArrowUpRightIcon
                      aria-hidden
                      className="ml-1 inline size-3 align-baseline text-muted-foreground"
                    />
                  </a>
                </TableCell>
                <TableCell>
                  <ProjectCombobox
                    projects={projects}
                    value={receipt.project}
                    onValueChange={(next) =>
                      report(
                        edit({ id: receipt.id, project: next }),
                        "已儲存"
                      ).catch(() => {})
                    }
                    placeholder="未填"
                    aria-label={`${receipt.name} 的計畫`}
                    className="-mx-3 w-40 border-transparent hover:border-input dark:bg-transparent"
                  />
                </TableCell>
                <TableCell>
                  {receipt.depositAccount &&
                    depositAccounts[receipt.depositAccount]}
                </TableCell>
                <TableCell>{receipt.uploader}</TableCell>
                <TableCell className="tabular-nums">
                  {day(receipt.createdAt)}
                </TableCell>
                <TableCell>
                  {receipt.status === "approved" ? (
                    <Badge variant="muted">{receiptStatuses.approved}</Badge>
                  ) : (
                    receiptStatuses.pending
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <ReceiptActions receipt={receipt} projects={projects} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
