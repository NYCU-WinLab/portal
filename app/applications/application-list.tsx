"use client"

import { EllipsisIcon } from "lucide-react"
import * as React from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { ExpandRow } from "@/components/expand-row"
import { FieldList, FieldRow } from "@/components/field-list"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  EVENT_LABELS,
  LAB_STATUS_LABELS,
  PROFILE_FIELDS,
  REQUESTED_STATUS_LABELS,
  STATUS_BADGES,
  STATUS_LABELS,
  actorName,
  awaitsPassword,
  eventDetail,
  stepRows,
  taipeiTime,
  type StepState,
} from "@/lib/applications/review-display"
import type { ReviewItem } from "@/lib/applications/views"
import { report } from "@/lib/report"
import { cn } from "@/lib/utils"

import { resendPasswordMail } from "./actions"
import {
  AcceptDialog,
  type Control,
  EditDialog,
  type MailGroup,
  RejectDialog,
  RequestChangesDialog,
  RetryDialog,
} from "./review-dialogs"

type Dialog = "edit" | "changes" | "accept" | "reject" | "retry" | "resend"

/** The verbs a row offers in its state, destructive last. */
function verbsFor(item: ReviewItem): { dialog: Dialog; label: string }[] {
  const verbs: { dialog: Dialog; label: string }[] = []
  const expired = item.changeRequest?.expired ?? false
  if (item.status === "pending") {
    verbs.push({ dialog: "accept", label: "核准" })
    verbs.push({ dialog: "edit", label: "修改資料" })
  }
  if (
    item.status === "pending" ||
    (item.status === "changes_requested" && expired)
  )
    verbs.push({ dialog: "changes", label: "請申請人修改" })
  if (
    item.status === "provisioning" &&
    (item.provisioning?.blockedAt || item.provisioning?.error)
  )
    verbs.push({ dialog: "retry", label: "重試" })
  if (awaitsPassword(item) && item.passwordMail?.canResend)
    verbs.push({ dialog: "resend", label: "重寄設定密碼信" })
  if (item.status === "pending" || item.status === "changes_requested")
    verbs.push({ dialog: "reject", label: "退回" })
  return verbs
}

function RowActions({
  item,
  groups,
}: {
  item: ReviewItem
  groups: MailGroup[]
}) {
  const verbs = verbsFor(item)
  // Each dialog remounts when it opens, so it starts from fresh input.
  const [opened, setOpened] = React.useState<{ dialog: Dialog; key: number }>()
  if (verbs.length === 0) return null
  const control = (dialog: Dialog): Control => ({
    open: opened?.dialog === dialog,
    onOpenChange: (open) => {
      if (!open) setOpened(undefined)
    },
  })
  const keyOf = (dialog: Dialog) =>
    `${dialog}-${opened?.dialog === dialog ? opened.key : 0}`
  const has = (dialog: Dialog) => verbs.some((v) => v.dialog === dialog)
  const last = verbs.at(-1)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" aria-label="更多" />}
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {verbs.map((verb) => (
            <React.Fragment key={verb.dialog}>
              {verb === last &&
                verb.dialog === "reject" &&
                verbs.length > 1 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onClick={() =>
                  setOpened((was) => ({
                    dialog: verb.dialog,
                    key: (was?.key ?? 0) + 1,
                  }))
                }
              >
                {verb.label}
              </DropdownMenuItem>
            </React.Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {has("edit") && (
        <EditDialog key={keyOf("edit")} item={item} control={control("edit")} />
      )}
      {has("changes") && (
        <RequestChangesDialog
          key={keyOf("changes")}
          item={item}
          control={control("changes")}
        />
      )}
      {has("accept") && (
        <AcceptDialog
          key={keyOf("accept")}
          item={item}
          groups={groups}
          control={control("accept")}
        />
      )}
      {has("reject") && (
        <RejectDialog
          key={keyOf("reject")}
          item={item}
          control={control("reject")}
        />
      )}
      {has("retry") && (
        <RetryDialog
          key={keyOf("retry")}
          item={item}
          control={control("retry")}
        />
      )}
      {has("resend") && (
        <ConfirmDialog
          {...control("resend")}
          title="重寄設定密碼信？"
          confirmLabel="重寄"
          variant="default"
          onConfirm={() =>
            report(resendPasswordMail({ id: item.id }), "已排入寄信")
          }
        />
      )}
    </>
  )
}

const STEP_STATE_TEXT: Record<StepState, string> = {
  done: "完成",
  running: "進行中",
  failed: "失敗，會再試",
  blocked: "卡住",
  waiting: "等待",
}

function UsernameTaken({ taken }: { taken: boolean | null }) {
  if (taken === null)
    return <span className="text-muted-foreground">（無法確認是否被使用）</span>
  if (taken) return <span className="text-destructive">（已被使用）</span>
  return <span className="text-muted-foreground">（可用）</span>
}

function Details({
  item,
  names,
  groups,
}: {
  item: ReviewItem
  names: ReadonlyMap<string, string>
  groups: MailGroup[]
}) {
  const address = (id: string) =>
    groups.find((g) => g.groupId === id)?.address ?? id
  const open = ["pending", "changes_requested"].includes(item.status)
  const run = item.provisioning
  return (
    <div className="flex flex-col gap-6">
      <FieldList>
        <FieldRow label="Email">{item.email ?? "已清除"}</FieldRow>
        <FieldRow label="申請身分">
          {REQUESTED_STATUS_LABELS[item.requestedStatus]}
        </FieldRow>
        {item.profile &&
          PROFILE_FIELDS.map(({ key, label }) => (
            <FieldRow key={key} label={label}>
              {item.profile?.[key] ?? "未填"}
              {key === "username" && open && !item.assignment && (
                <UsernameTaken taken={item.usernameTaken} />
              )}
            </FieldRow>
          ))}
        <FieldRow label="送出">
          <span className="tabular-nums">{taipeiTime(item.submittedAt)}</span>
        </FieldRow>
        {item.closedAt && (
          <FieldRow label="結案">
            <span className="tabular-nums">{taipeiTime(item.closedAt)}</span>
          </FieldRow>
        )}
        {item.reviewNote && (
          <FieldRow label="退回原因">{item.reviewNote}</FieldRow>
        )}
        {item.changeRequest && (
          <>
            <FieldRow label="請申請人修改">
              {item.changeRequest.note ?? "沒有說明"}
            </FieldRow>
            <FieldRow label="修改期限">
              <span
                className={cn(
                  "tabular-nums",
                  item.changeRequest.expired && "text-destructive"
                )}
              >
                {taipeiTime(item.changeRequest.dueAt)}
                {item.changeRequest.expired && "（已過期）"}
              </span>
            </FieldRow>
          </>
        )}
        {open && (
          <FieldRow label="預設值">
            {LAB_STATUS_LABELS[item.defaults.labStatus]}，{item.defaults.cohort}{" "}
            學年度
            {item.defaults.mailGroups.length > 0 &&
              `，群組信 ${item.defaults.mailGroups.map(address).join("、")}`}
          </FieldRow>
        )}
        {item.assignment && (
          <FieldRow label="核准設定">
            {LAB_STATUS_LABELS[item.assignment.status]}，
            {item.assignment.cohort} 學年度，
            <span className="font-mono">{item.assignment.username}</span>
            {item.usernameTaken !== null && (
              <UsernameTaken taken={item.usernameTaken} />
            )}
            {item.assignment.mailGroups.length > 0 &&
              `，群組信 ${item.assignment.mailGroups
                .map((g) => g.address ?? g.groupId)
                .join("、")}`}
          </FieldRow>
        )}
        {run && !run.finishedAt && (
          <FieldRow label="建立帳號">
            <ol className="flex flex-col gap-1">
              {stepRows(run).map((step) => (
                <li key={step.name} className="flex gap-2">
                  <span>{step.label}</span>
                  <span
                    className={cn(
                      "text-muted-foreground",
                      (step.state === "blocked" || step.state === "failed") &&
                        "text-destructive"
                    )}
                  >
                    {STEP_STATE_TEXT[step.state]}
                  </span>
                </li>
              ))}
            </ol>
            {run.error && (
              <p className="text-destructive">
                {run.blockedAt ? "卡住的原因" : "上次失敗"}：{run.error}
              </p>
            )}
          </FieldRow>
        )}
        {awaitsPassword(item) && item.passwordMail && (
          <FieldRow label="設定密碼信">
            {item.passwordMail.lastSentAt ? (
              <span className="tabular-nums">
                {taipeiTime(item.passwordMail.lastSentAt)} 寄出
                {item.passwordMail.expiresAt &&
                  `，${taipeiTime(item.passwordMail.expiresAt)} 到期`}
              </span>
            ) : (
              "還沒寄出"
            )}
          </FieldRow>
        )}
        {item.history.length > 0 && (
          <FieldRow label="過去的申請">
            <ul className="flex flex-col gap-1">
              {item.history.map((h) => (
                <li key={h.id} className="tabular-nums">
                  {taipeiTime(h.createdAt)} {STATUS_LABELS[h.status]}
                </li>
              ))}
            </ul>
          </FieldRow>
        )}
      </FieldList>
      {item.events.length > 0 && (
        <ol className="flex flex-col gap-2">
          {item.events.map((e) => {
            const detail = eventDetail(e)
            return (
              <li key={e.id} className="flex gap-4">
                <span className="w-36 shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
                  {taipeiTime(e.at)}
                </span>
                <span className="min-w-0">
                  {actorName(e, names)} {EVENT_LABELS[e.kind]}
                  {detail && (
                    <span className="text-muted-foreground">：{detail}</span>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function Summary({ item }: { item: ReviewItem }) {
  const due = item.status === "changes_requested" ? item.changeRequest : null
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
      <span className="truncate font-medium">
        {item.profile?.chineseName ?? item.email ?? "已清除的申請"}
      </span>
      <Badge variant={STATUS_BADGES[item.status]}>
        {STATUS_LABELS[item.status]}
      </Badge>
      <span className="text-muted-foreground">
        {REQUESTED_STATUS_LABELS[item.requestedStatus]}
      </span>
      <span className="text-muted-foreground tabular-nums">
        {taipeiTime(item.submittedAt)}
      </span>
      {due && (
        <span
          className={cn(
            "tabular-nums",
            due.expired ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {due.expired ? "已過修改期限" : `${taipeiTime(due.dueAt)} 前修改`}
        </span>
      )}
      {item.provisioning?.blockedAt && (
        <span className="text-destructive">建立帳號卡住</span>
      )}
      {awaitsPassword(item) && (
        <span className="text-muted-foreground">還沒設定密碼</span>
      )}
    </div>
  )
}

function List({
  items,
  names,
  groups,
}: {
  items: ReviewItem[]
  names: ReadonlyMap<string, string>
  groups: MailGroup[]
}) {
  if (items.length === 0) return <EmptyState noun="申請" />
  return (
    <ul className="flex stagger-rise flex-col">
      {items.map((item) => (
        <ExpandRow
          key={item.id}
          summary={<Summary item={item} />}
          actions={<RowActions item={item} groups={groups} />}
        >
          <Details item={item} names={names} groups={groups} />
        </ExpandRow>
      ))}
    </ul>
  )
}

export function ApplicationList({
  open,
  closed,
  names,
  groups,
}: {
  open: ReviewItem[]
  closed: ReviewItem[]
  /** Member id to name, for who did what in the timeline. */
  names: Record<string, string>
  /** The default mail groups with their addresses. */
  groups: MailGroup[]
}) {
  const nameMap = React.useMemo(() => new Map(Object.entries(names)), [names])
  return (
    <Tabs defaultValue="open">
      <TabsList>
        <TabsTrigger value="open">待處理 {open.length}</TabsTrigger>
        <TabsTrigger value="closed">已結案 {closed.length}</TabsTrigger>
      </TabsList>
      <TabsContent value="open">
        <List items={open} names={nameMap} groups={groups} />
      </TabsContent>
      <TabsContent value="closed">
        <List items={closed} names={nameMap} groups={groups} />
      </TabsContent>
    </Tabs>
  )
}
