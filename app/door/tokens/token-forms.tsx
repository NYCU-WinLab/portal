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
import { report } from "@/lib/report"

import { createDoorTokenAction, revokeDoorTokenAction } from "./actions"

/** The curl line that opens the door with a token. */
export const curlLine = (token: string) =>
  `curl -X POST -H "Authorization: Bearer ${token}" https://portal.winlab.tw/api/door/open`

export function CreateToken() {
  const [token, setToken] = React.useState<string | null>(null)

  async function submit(data: FormData) {
    const { token, error } = await createDoorTokenAction(
      String(data.get("name") ?? "")
    )
    if (error) {
      toast.error(error)
      throw new Error(error)
    }
    toast.success("已建立")
    setToken(token!)
  }

  return (
    <>
      <FormDialog
        trigger={<Button>建立金鑰</Button>}
        title="建立開門金鑰"
        submitLabel="建立"
        onSubmit={submit}
      >
        <FormField label="名稱" required>
          <Input name="name" maxLength={60} placeholder="iPhone 捷徑" />
        </FormField>
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
            拿到金鑰的人都能用你的名字開門，不要放進 git 或傳給別人。
          </p>
          <p className="font-mono break-all text-muted-foreground select-all">
            {token && curlLine(token)}
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function RevokeToken({ id, name }: { id: string; name: string }) {
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
      onConfirm={() => report(revokeDoorTokenAction(id), "已撤銷")}
    />
  )
}
