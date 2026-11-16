"use client"

import { Trash2Icon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

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
import { Toggle } from "@/components/ui/toggle"
import { report } from "@/lib/report"

import {
  addSshKeyAction,
  deleteSshKeyAction,
  importSshKeysAction,
  setSshKeyServiceAction,
} from "./actions"

export function AddKey() {
  return (
    <FormDialog
      trigger={<Button>新增金鑰</Button>}
      title="新增金鑰"
      submitLabel="新增"
      onSubmit={(data) =>
        report(
          addSshKeyAction({
            public_key: String(data.get("public_key") ?? ""),
            label: String(data.get("label") ?? ""),
          }),
          "已新增"
        )
      }
    >
      <FormField label="公鑰" required>
        <Textarea
          name="public_key"
          rows={4}
          maxLength={8192}
          placeholder="ssh-ed25519 AAAA…"
          className="font-mono break-all"
        />
      </FormField>
      <FormField label="名稱">
        <Input name="label" maxLength={60} placeholder="MacBook" />
      </FormField>
    </FormDialog>
  )
}

export function ImportKeys({
  hosts,
}: {
  hosts: { value: string; label: string }[]
}) {
  async function submit(data: FormData) {
    const outcome = await importSshKeysAction({
      host: String(data.get("host") ?? ""),
      username: String(data.get("username") ?? ""),
    })
    if ("error" in outcome && outcome.error) {
      toast.error(outcome.error)
      throw new Error(outcome.error)
    }
    toast.success(
      outcome.added ? `已匯入 ${outcome.added} 把` : "這些金鑰都已經有了"
    )
  }

  return (
    <FormDialog
      trigger={<Button variant="outline">匯入</Button>}
      title="匯入金鑰"
      submitLabel="匯入"
      onSubmit={submit}
    >
      <FormField label="來源" required>
        <Select name="host" defaultValue={hosts[0]?.value} items={hosts}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {hosts.map((host) => (
              <SelectItem key={host.value} value={host.value}>
                {host.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="帳號" required>
        <Input name="username" maxLength={64} autoCapitalize="none" />
      </FormField>
    </FormDialog>
  )
}

export function DeleteKey({ id, label }: { id: string; label: string }) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon" aria-label={`刪除 ${label}`}>
          <Trash2Icon />
        </Button>
      }
      title={`刪除「${label}」？`}
      confirmLabel="刪除"
      variant="destructive"
      onConfirm={() => report(deleteSshKeyAction(id), "已刪除")}
    />
  )
}

/** One toggle per service the member may use: on means the service's
 * machines accept this key. */
export function KeyServices({
  id,
  services,
  used,
}: {
  id: string
  services: { slug: string; name: string }[]
  used: string[]
}) {
  const [pending, startTransition] = React.useTransition()
  return (
    <div className="flex flex-wrap gap-2">
      {services.map((service) => (
        <Toggle
          key={service.slug}
          size="text"
          disabled={pending}
          pressed={used.includes(service.slug)}
          onPressedChange={(next) =>
            startTransition(async () => {
              await report(
                setSshKeyServiceAction({
                  id,
                  service: service.slug,
                  used: next,
                }),
                next ? `${service.name} 已啟用` : `${service.name} 已停用`
              ).catch(() => {})
            })
          }
        >
          {service.name}
        </Toggle>
      ))}
    </div>
  )
}
