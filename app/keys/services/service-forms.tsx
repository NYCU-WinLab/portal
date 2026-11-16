"use client"

import { RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { FormDialog, FormField } from "@/components/form-dialog"
import { type Member, MemberCombobox } from "@/components/member-combobox"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { report } from "@/lib/report"

import {
  createSshServiceAction,
  deleteSshServiceAction,
  grantSshServiceAction,
  revokeSshServiceGrantAction,
  rotateSshServiceKeyAction,
} from "../actions"
import { serviceLine } from "../nav"

type Issued = { token: string; slug: string }

/** A read key, shown the one time it exists outside its hash. */
function IssuedKey({
  issued,
  onClose,
}: {
  issued: Issued | null
  onClose: () => void
}) {
  return (
    <Dialog open={issued !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>讀取金鑰只顯示這一次</DialogTitle>
        </DialogHeader>
        <p className="font-mono break-all select-all">{issued?.token}</p>
        <p className="font-mono break-all text-muted-foreground select-all">
          {issued && serviceLine(issued.token, issued.slug)}
        </p>
      </DialogContent>
    </Dialog>
  )
}

/** Takes what a create or rotate returned: toasts, and hands back the key. */
function issue(
  outcome:
    { error: string } | { error?: undefined; token: string; slug: string },
  success: string
): Issued {
  if (outcome.error !== undefined) {
    toast.error(outcome.error)
    throw new Error(outcome.error)
  }
  toast.success(success)
  return { token: outcome.token, slug: outcome.slug }
}

export function CreateService() {
  const [issued, setIssued] = React.useState<Issued | null>(null)
  const [open, setOpen] = React.useState(true)

  async function submit(data: FormData) {
    setIssued(
      issue(
        await createSshServiceAction({
          name: String(data.get("name") ?? ""),
          slug: String(data.get("slug") ?? ""),
          open,
        }),
        "已建立"
      )
    )
  }

  return (
    <>
      <FormDialog
        trigger={<Button>建立服務</Button>}
        title="建立服務"
        submitLabel="建立"
        onSubmit={submit}
      >
        <FormField label="名稱" required>
          <Input name="name" maxLength={60} placeholder="B09 跳板機" />
        </FormField>
        <FormField label="代號" required>
          <Input
            name="slug"
            maxLength={32}
            pattern="[a-z0-9][a-z0-9-]*"
            autoCapitalize="none"
            placeholder="b09"
            className="font-mono"
          />
        </FormField>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="service-open">所有成員可用</Label>
          <Switch id="service-open" checked={open} onCheckedChange={setOpen} />
        </div>
      </FormDialog>
      <IssuedKey issued={issued} onClose={() => setIssued(null)} />
    </>
  )
}

export function RotateServiceKey({ id, name }: { id: string; name: string }) {
  const [issued, setIssued] = React.useState<Issued | null>(null)
  return (
    <>
      <ConfirmDialog
        trigger={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`重發 ${name} 的讀取金鑰`}
          >
            <RefreshCwIcon />
          </Button>
        }
        title={`重發「${name}」的讀取金鑰？舊金鑰會立刻失效`}
        confirmLabel="重發"
        onConfirm={async () =>
          setIssued(issue(await rotateSshServiceKeyAction(id), "已重發"))
        }
      />
      <IssuedKey issued={issued} onClose={() => setIssued(null)} />
    </>
  )
}

export function DeleteService({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon" aria-label={`刪除 ${name}`}>
          <Trash2Icon />
        </Button>
      }
      title={`刪除「${name}」？機器會立刻讀不到名單`}
      confirmLabel="刪除"
      variant="destructive"
      onConfirm={() => report(deleteSshServiceAction(id), "已刪除")}
    />
  )
}

/** Choosing a member grants at once: one step, no second button. */
export function GrantMember({
  id,
  members,
}: {
  id: string
  members: Member[]
}) {
  const [pending, startTransition] = React.useTransition()
  return (
    <MemberCombobox
      members={members}
      placeholder="加入成員"
      disabled={pending}
      value={null}
      onValueChange={(userId) => {
        if (!userId) return
        startTransition(async () => {
          await report(
            grantSshServiceAction({ id, user_id: userId }),
            "已加入"
          ).catch(() => {})
        })
      }}
      className="w-full sm:w-64"
    />
  )
}

export function RevokeGrant({
  id,
  userId,
  name,
}: {
  id: string
  userId: string
  name: string
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon" aria-label={`移除 ${name}`}>
          <XIcon />
        </Button>
      }
      title={`移除 ${name}？他放在這裡的金鑰會一起拿掉`}
      confirmLabel="移除"
      onConfirm={() =>
        report(revokeSshServiceGrantAction({ id, user_id: userId }), "已移除")
      }
    />
  )
}
