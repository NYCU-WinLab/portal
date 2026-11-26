"use client"

import { PencilIcon, XIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { FormDialog, FormField } from "@/components/form-dialog"
import { type Member, MemberCombobox } from "@/components/member-combobox"
import { SectionHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { report } from "@/lib/report"

import { saveApplySiteUrl, setMailGroup, setNotifiee } from "../actions"

const row = "flex min-h-14 items-center gap-4 border-b border-border py-2"

/** Who is mailed when an application comes in. */
export function NotifieeSection({
  notifiees,
  members,
}: {
  notifiees: { userId: string; name: string; email: string }[]
  members: Member[]
}) {
  const [userId, setUserId] = React.useState<string | null>(null)
  const listed = new Set(notifiees.map((n) => n.userId))

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader
        title="新申請通知"
        actions={
          <FormDialog
            trigger={<Button variant="outline">新增</Button>}
            title="新增通知對象"
            submitLabel="新增"
            onSubmit={async () => {
              if (!userId) {
                toast.error("請選擇成員")
                throw new Error("no member")
              }
              await report(setNotifiee({ userId, notify: true }), "已新增")
              setUserId(null)
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="notifiee-member">成員</Label>
              <MemberCombobox
                id="notifiee-member"
                members={members.filter((m) => !listed.has(m.id))}
                value={userId}
                onValueChange={setUserId}
                className="w-full"
              />
            </div>
          </FormDialog>
        }
      />
      <ul className="flex stagger-rise flex-col">
        {notifiees.length === 0 && (
          <li className={`${row} text-destructive`}>
            沒有通知對象，新申請不會寄信通知任何人
          </li>
        )}
        {notifiees.map((n) => (
          <li key={n.userId} className={row}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{n.name}</span>
              <span className="truncate text-muted-foreground">{n.email}</span>
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="移除"
                    onClick={() =>
                      report(
                        setNotifiee({ userId: n.userId, notify: false }),
                        "已移除"
                      ).catch(() => {})
                    }
                  />
                }
              >
                <XIcon />
              </TooltipTrigger>
              <TooltipContent>移除</TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The mail groups every approval starts with. */
export function MailGroupSection({
  groups,
  failed,
}: {
  groups: { groupId: string; address: string; enabled: boolean }[]
  /** Why the groups this member manages could not be read. */
  failed: string | null
}) {
  const [pending, setPending] = React.useState<string | null>(null)

  async function toggle(groupId: string, enabled: boolean) {
    setPending(groupId)
    try {
      await report(
        setMailGroup({ groupId, enabled }),
        enabled ? "已設為預設" : "已取消預設"
      )
    } catch {
      // report already said why.
    } finally {
      setPending(null)
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="核准時預設加入的群組信" />
      {failed && <p className="text-destructive">{failed}</p>}
      <ul className="flex stagger-rise flex-col">
        {groups.length === 0 && (
          <li className={`${row} text-muted-foreground`}>
            你沒有可以管理的群組信
          </li>
        )}
        {groups.map((g) => {
          const id = `default-${g.groupId}`
          return (
            <li key={g.groupId} className={row}>
              <label htmlFor={id} className="min-w-0 flex-1 truncate">
                {g.address}
              </label>
              <Switch
                id={id}
                checked={g.enabled}
                disabled={pending === g.groupId}
                onCheckedChange={(on) => void toggle(g.groupId, on)}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Where application mails link to. */
export function ApplySiteSection({
  url,
  changed,
}: {
  url: string | null
  /** Who changed it last and when. */
  changed: string | null
}) {
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="申請網站" />
      <div className={row}>
        <span className="flex min-w-0 flex-1 flex-col">
          {url ? (
            <span className="truncate font-mono">{url}</span>
          ) : (
            <span className="text-destructive">
              還沒設定，寄不出帶連結的申請信
            </span>
          )}
          {changed && (
            <span className="truncate text-muted-foreground">{changed}</span>
          )}
        </span>
        <Tooltip>
          <FormDialog
            trigger={
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon" aria-label="修改" />
                }
              >
                <PencilIcon />
              </TooltipTrigger>
            }
            title="申請網站網址"
            submitLabel="儲存"
            onSubmit={(data) =>
              report(
                saveApplySiteUrl({ url: String(data.get("url") ?? "").trim() }),
                "已儲存"
              )
            }
          >
            <FormField label="網址（https，winlab.tw 底下）" required>
              <Input
                name="url"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                placeholder="https://apply.winlab.tw"
                defaultValue={url ?? ""}
                className="font-mono"
              />
            </FormField>
          </FormDialog>
          <TooltipContent>修改</TooltipContent>
        </Tooltip>
      </div>
    </section>
  )
}
