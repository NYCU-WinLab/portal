"use client"

import { CheckIcon, CopyIcon, PencilIcon, Trash2Icon } from "lucide-react"
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
import { report } from "@/lib/report"

import {
  addSshKeyAction,
  deleteSshKeyAction,
  importSshKeysAction,
  setSshServiceKeyAction,
  updateSshKeyAction,
} from "./actions"

type KeyNotes = { label: string; machine: string; description: string }

const notes = (data: FormData): KeyNotes => ({
  label: String(data.get("label") ?? ""),
  machine: String(data.get("machine") ?? ""),
  description: String(data.get("description") ?? ""),
})

/** What a key says about itself: its name, where it lives, what it is for. */
function NoteFields({
  value,
  required,
}: {
  value?: KeyNotes
  required?: boolean
}) {
  return (
    <>
      <FormField label="名稱" required={required}>
        <Input
          name="label"
          maxLength={60}
          required={required}
          defaultValue={value?.label}
          placeholder="loki"
        />
      </FormField>
      <FormField label="機器">
        <Input
          name="machine"
          maxLength={60}
          defaultValue={value?.machine}
          placeholder="MacBook Air"
        />
      </FormField>
      <FormField label="用途">
        <Textarea
          name="description"
          rows={2}
          maxLength={200}
          defaultValue={value?.description}
          placeholder="個人筆電，開機器給我時用這把"
        />
      </FormField>
    </>
  )
}

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
            ...notes(data),
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
      <NoteFields />
    </FormDialog>
  )
}

export function EditKey({ id, value }: { id: string; value: KeyNotes }) {
  return (
    <FormDialog
      trigger={
        <Button variant="ghost" size="icon" aria-label={`修改 ${value.label}`}>
          <PencilIcon />
        </Button>
      }
      title="修改金鑰"
      submitLabel="儲存"
      onSubmit={(data) =>
        report(updateSshKeyAction({ id, ...notes(data) }), "已儲存")
      }
    >
      <NoteFields value={value} required />
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

/** Copies the key's authorized_keys line, to paste into a machine. */
export function CopyKey({ label, line }: { label: string; line: string }) {
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`複製 ${label} 的公鑰`}
      onClick={() =>
        navigator.clipboard.writeText(line).then(
          () => {
            setCopied(true)
            toast.success("已複製公鑰")
          },
          () => toast.error("複製失敗")
        )
      }
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
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

/** Which of the member's keys one service uses. */
export function ServiceKey({
  service,
  keys,
  value,
}: {
  service: { slug: string; name: string }
  keys: { value: string; label: string }[]
  value: string
}) {
  const [pending, startTransition] = React.useTransition()
  return (
    <Select
      value={value}
      items={keys}
      disabled={pending}
      onValueChange={(id) => {
        if (!id || id === value) return
        startTransition(async () => {
          await report(
            setSshServiceKeyAction({ service: service.slug, id }),
            `${service.name} 改用這把`
          ).catch(() => {})
        })
      }}
    >
      <SelectTrigger aria-label={`${service.name} 用的金鑰`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {keys.map((key) => (
          <SelectItem key={key.value} value={key.value}>
            {key.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
