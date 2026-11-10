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
import { listLine, serviceApps, type ServiceApp } from "@/lib/api-apps"
import { report } from "@/lib/report"

import { type AppActions, AppPicker } from "./app-picker"

import { createServiceKeyAction, revokeServiceKeyAction } from "./actions"

export function CreateServiceKey({ actions }: { actions: AppActions }) {
  const [token, setToken] = React.useState<string | null>(null)
  const [apps, setApps] = React.useState<Set<ServiceApp>>(new Set())

  async function submit(data: FormData) {
    const { token, error } = await createServiceKeyAction({
      service: String(data.get("service") ?? ""),
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

  return (
    <>
      <FormDialog
        trigger={<Button variant="outline">建立服務金鑰</Button>}
        title="建立服務金鑰"
        submitLabel="建立"
        onSubmit={submit}
        size="wide"
      >
        <FormField label="服務" required>
          <Input name="service" maxLength={60} placeholder="viewer.winlab.tw" />
        </FormField>
        <AppPicker
          apps={serviceApps}
          actions={actions}
          value={apps}
          onChange={setApps}
        />
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
          <p className="text-muted-foreground">不要放進 git。</p>
          <p className="font-mono break-all text-muted-foreground select-all">
            {token && listLine(token)}
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function RevokeServiceKey({
  id,
  service,
}: {
  id: string
  service: string
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon" aria-label={`撤銷 ${service}`}>
          <Trash2Icon />
        </Button>
      }
      title={`撤銷「${service}」的金鑰？`}
      confirmLabel="撤銷"
      variant="destructive"
      onConfirm={() => report(revokeServiceKeyAction(id), "已撤銷")}
    />
  )
}
