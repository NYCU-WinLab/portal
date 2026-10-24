"use client"

import { Trash2Icon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { apiApps, apiAppKeys, listLine, type ApiApp } from "@/lib/api-apps"
import { report } from "@/lib/report"

import { createApiKeyAction, revokeApiKeyAction } from "./actions"

export function CreateKey() {
  const [token, setToken] = React.useState<string | null>(null)
  const [apps, setApps] = React.useState<Set<ApiApp>>(new Set())

  async function submit(data: FormData) {
    const { token, error } = await createApiKeyAction({
      name: String(data.get("name") ?? ""),
      apps: [...apps],
    })
    if (error) {
      toast.error(error)
      throw new Error(error)
    }
    toast.success("已建立")
    setApps(new Set())
    setToken(token!)
  }

  function toggle(app: ApiApp, on: boolean) {
    setApps((current) => {
      const next = new Set(current)
      if (on) next.add(app)
      else next.delete(app)
      return next
    })
  }

  return (
    <>
      <FormDialog
        trigger={<Button>建立金鑰</Button>}
        title="建立 API 金鑰"
        submitLabel="建立"
        onSubmit={submit}
      >
        <FormField label="名稱" required>
          <Input name="name" maxLength={60} placeholder="iPhone 捷徑" />
        </FormField>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2">可以用的 app</legend>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {apiAppKeys.map((app) => (
              <label key={app} className="flex items-center gap-3">
                <Switch
                  checked={apps.has(app)}
                  onCheckedChange={(on) => toggle(app, on)}
                />
                {apiApps[app]}
              </label>
            ))}
          </div>
        </fieldset>
      </FormDialog>
      <Dialog
        open={token !== null}
        onOpenChange={(open) => !open && setToken(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>金鑰只顯示這一次</DialogTitle>
          </DialogHeader>
          <p className="font-mono break-all select-all">{token}</p>
          <p className="text-muted-foreground">
            拿到金鑰的人都能用你的名字使用選的 app，不要放進 git 或傳給別人。
          </p>
          <p className="font-mono break-all text-muted-foreground select-all">
            {token && listLine(token)}
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function RevokeKey({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon" aria-label={`撤銷 ${name}`}>
          <Trash2Icon />
        </Button>
      }
      title={`撤銷「${name}」？`}
      confirmLabel="撤銷"
      variant="destructive"
      onConfirm={() => report(revokeApiKeyAction(id), "已撤銷")}
    />
  )
}
