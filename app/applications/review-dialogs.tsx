"use client"

import * as React from "react"

import { FormDialog, FormField } from "@/components/form-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { USERNAME_PATTERN_CLIENT } from "@/lib/applications/domain/constants"
import {
  LAB_STATUS_LABELS,
  PROFILE_FIELDS,
  REQUESTED_STATUS_LABELS,
  profilePatch,
  retryChange,
} from "@/lib/applications/review-display"
import type { ReviewItem } from "@/lib/applications/views"
import { report } from "@/lib/report"

import {
  acceptApplication,
  rejectApplication,
  requestChanges,
  retryProvisioning,
  updateApplication,
} from "./actions"

export type Control = { open: boolean; onOpenChange: (open: boolean) => void }
export type MailGroup = { groupId: string; address: string | null }

const text = (data: FormData, key: string) => String(data.get(key) ?? "")
const requested = Object.entries(REQUESTED_STATUS_LABELS).map(
  ([value, label]) => ({ value, label })
)

/** 修改資料: a pending application's fields, typos fixed by the processor. */
export function EditDialog({
  item,
  control,
}: {
  item: ReviewItem
  control: Control
}) {
  const profile = item.profile
  if (!profile) return null
  return (
    <FormDialog
      {...control}
      size="wide"
      title="修改資料"
      submitLabel="儲存"
      onSubmit={(data) => {
        const form = Object.fromEntries(
          PROFILE_FIELDS.map(({ key }) => [key, text(data, key)])
        )
        const status = text(data, "requestedStatus")
        return report(
          updateApplication({
            id: item.id,
            version: item.version,
            patch: {
              ...(status !== item.requestedStatus && {
                requestedStatus: status,
              }),
              profile: profilePatch(profile, form),
            },
          }),
          "已儲存"
        )
      }}
    >
      <FormField label="申請身分" required>
        <Select
          name="requestedStatus"
          defaultValue={item.requestedStatus}
          items={requested}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {requested.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      {PROFILE_FIELDS.map(({ key, label, optional }) => (
        <FormField key={key} label={label} required={!optional}>
          <Input
            name={key}
            defaultValue={profile[key] ?? ""}
            type={key === "birthday" ? "date" : "text"}
          />
        </FormField>
      ))}
    </FormDialog>
  )
}

/** 請申請人修改: a note the applicant reads, with a 7-day deadline. */
export function RequestChangesDialog({
  item,
  control,
}: {
  item: ReviewItem
  control: Control
}) {
  return (
    <FormDialog
      {...control}
      title="請申請人修改"
      submitLabel="寄出"
      onSubmit={(data) =>
        report(
          requestChanges({
            id: item.id,
            version: item.version,
            note: text(data, "note").trim(),
          }),
          "已寄信給申請人"
        )
      }
    >
      <FormField label="要改什麼（申請人看得到，7 天內修改）" required>
        <Textarea name="note" rows={4} maxLength={2000} />
      </FormField>
    </FormDialog>
  )
}

function MailGroupSwitches({
  groups,
  chosen,
  onChange,
}: {
  groups: MailGroup[]
  chosen: Set<string>
  onChange: (next: Set<string>) => void
}) {
  if (groups.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <span className="font-medium">加入群組信</span>
      {groups.map((group) => {
        const id = `group-${group.groupId}`
        return (
          <div
            key={group.groupId}
            className="flex items-center justify-between gap-4"
          >
            <Label htmlFor={id} className="min-w-0 truncate">
              {group.address ?? group.groupId}
            </Label>
            <Switch
              id={id}
              checked={chosen.has(group.groupId)}
              onCheckedChange={(on) => {
                const next = new Set(chosen)
                if (on) next.add(group.groupId)
                else next.delete(group.groupId)
                onChange(next)
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

/** 核准: the defaults filled in, the status limited to what this processor
 * may assign. */
export function AcceptDialog({
  item,
  groups,
  control,
}: {
  item: ReviewItem
  groups: MailGroup[]
  control: Control
}) {
  const [chosen, setChosen] = React.useState(
    () => new Set(item.defaults.mailGroups)
  )
  const statuses = item.assignableStatuses.map((value) => ({
    value,
    label: LAB_STATUS_LABELS[value],
  }))
  const status = item.assignableStatuses.includes(item.defaults.labStatus)
    ? item.defaults.labStatus
    : item.assignableStatuses[0]
  return (
    <FormDialog
      {...control}
      title="核准"
      submitLabel="核准"
      onSubmit={(data) =>
        report(
          acceptApplication({
            id: item.id,
            version: item.version,
            status: text(data, "status"),
            cohort: Number(text(data, "cohort")),
            username: text(data, "username").trim(),
            mailGroups: [...chosen],
          }),
          "已核准，開始建立帳號"
        )
      }
    >
      <FormField label="身分" required>
        <Select name="status" defaultValue={status} items={statuses}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statuses.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="學年度（入學）" required>
        <Input
          name="cohort"
          type="number"
          inputMode="numeric"
          min={100}
          max={999}
          defaultValue={item.defaults.cohort}
        />
      </FormField>
      <FormField label="username" required>
        <Input
          name="username"
          pattern={USERNAME_PATTERN_CLIENT}
          autoCapitalize="none"
          className="font-mono"
          defaultValue={item.profile?.username ?? ""}
        />
      </FormField>
      <MailGroupSwitches groups={groups} chosen={chosen} onChange={setChosen} />
    </FormDialog>
  )
}

/** 退回, with an optional note the applicant reads. */
export function RejectDialog({
  item,
  control,
}: {
  item: ReviewItem
  control: Control
}) {
  return (
    <FormDialog
      {...control}
      title="退回這筆申請？"
      submitLabel="退回"
      onSubmit={(data) => {
        const note = text(data, "note").trim()
        return report(
          rejectApplication({ id: item.id, ...(note && { note }) }),
          "已退回，已寄信給申請人"
        )
      }}
    >
      <FormField label="原因（申請人看得到，可不填）">
        <Textarea name="note" rows={3} maxLength={2000} />
      </FormField>
    </FormDialog>
  )
}

/** 重試: a blocked run starts over from its open step, with a new username
 * or cohort while the step that uses it has not run. */
export function RetryDialog({
  item,
  control,
}: {
  item: ReviewItem
  control: Control
}) {
  const done = new Set(item.provisioning?.steps.map((s) => s.name))
  const current = item.assignment
  return (
    <FormDialog
      {...control}
      title="重試建立帳號"
      submitLabel="重試"
      onSubmit={(data) =>
        report(
          retryProvisioning({
            id: item.id,
            ...(current &&
              retryChange(current, {
                username: done.has("create_account")
                  ? undefined
                  : text(data, "username"),
                cohort: done.has("join_keycloak_groups")
                  ? undefined
                  : text(data, "cohort"),
              })),
          }),
          "已排入重試"
        )
      }
    >
      {current && !done.has("create_account") && (
        <FormField label="username" required>
          <Input
            name="username"
            pattern={USERNAME_PATTERN_CLIENT}
            autoCapitalize="none"
            className="font-mono"
            defaultValue={current.username}
          />
        </FormField>
      )}
      {current && !done.has("join_keycloak_groups") && (
        <FormField label="學年度（入學）" required>
          <Input
            name="cohort"
            type="number"
            inputMode="numeric"
            min={100}
            max={999}
            defaultValue={current.cohort}
          />
        </FormField>
      )}
    </FormDialog>
  )
}
