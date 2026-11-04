"use client"

import { XIcon } from "lucide-react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { report } from "@/lib/report"
import { dayLabel } from "@/lib/rooms/time"

import { cancelAppointmentAction } from "../actions"

type Row = {
  id: string
  date: string
  start: string
  end: string
  title: string
  with: string
}

function List({ rows }: { rows: Row[] }) {
  if (!rows.length) return <EmptyState noun="預約" />
  return (
    <ul className="flex stagger-rise flex-col">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex min-h-14 items-center gap-4 border-b border-border py-2"
        >
          <span className="w-44 shrink-0 text-muted-foreground tabular-nums">
            {dayLabel(row.date)} {row.start}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">
            {row.title}
          </span>
          <span className="shrink-0 text-muted-foreground">{row.with}</span>
          <Tooltip>
            <ConfirmDialog
              trigger={
                <TooltipTrigger
                  render={
                    <Button variant="ghost" size="icon" aria-label="取消" />
                  }
                >
                  <XIcon />
                </TooltipTrigger>
              }
              title={`取消和 ${row.with} 的預約？`}
              confirmLabel="取消預約"
              variant="destructive"
              onConfirm={() =>
                report(cancelAppointmentAction(row.id), "已取消，已寄信通知")
              }
            />
            <TooltipContent>取消</TooltipContent>
          </Tooltip>
        </li>
      ))}
    </ul>
  )
}

export function AppointmentTabs({
  withMe,
  byMe,
}: {
  withMe: Row[]
  byMe: Row[]
}) {
  return (
    <Tabs defaultValue={withMe.length || !byMe.length ? "with-me" : "by-me"}>
      <TabsList>
        <TabsTrigger value="with-me">約我的 {withMe.length}</TabsTrigger>
        <TabsTrigger value="by-me">我約的 {byMe.length}</TabsTrigger>
      </TabsList>
      <TabsContent value="with-me">
        <List rows={withMe} />
      </TabsContent>
      <TabsContent value="by-me">
        <List rows={byMe} />
      </TabsContent>
    </Tabs>
  )
}
