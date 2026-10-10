"use client"

import { CheckIcon, PencilIcon, Trash2Icon, Undo2Icon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { FileUpload } from "@/components/file-upload"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Receipt } from "@/lib/actions/receipts"
import { depositAccounts } from "@/lib/receipts"
import { report } from "@/lib/report"

import { edit, remove, upload } from "./actions"

const LIMIT = 10 * 1024 * 1024
const MAX_SIDE = 2000
const accounts = Object.entries(depositAccounts).map(([value, label]) => ({
  value,
  label,
}))

/** A photo shrunk to at most 2000 px on its long side, as JPEG. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const ratio = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * ratio)
  canvas.height = Math.round(bitmap.height * ratio)
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("圖片轉檔失敗"))),
      "image/jpeg",
      0.85
    )
  )
}

async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const text = (data: FormData, key: string) => String(data.get(key) ?? "")

// Name, project (picked from the ones used, or typed) and account: the
// fields both forms share.
function Fields({
  receipt,
  projects,
}: {
  receipt?: Receipt
  projects: string[]
}) {
  return (
    <>
      <FormField label="名稱" required>
        <Input name="name" maxLength={200} defaultValue={receipt?.name} />
      </FormField>
      <FormField label="計畫">
        <Input
          name="project"
          maxLength={50}
          list="receipt-projects"
          defaultValue={receipt?.project ?? ""}
        />
      </FormField>
      <datalist id="receipt-projects">
        {projects.map((project) => (
          <option key={project} value={project} />
        ))}
      </datalist>
      <div className="flex flex-col gap-2">
        <Label htmlFor="receipt-account" className="gap-1">
          存入
          <span aria-hidden className="text-destructive">
            *
          </span>
        </Label>
        <Select
          name="depositAccount"
          required
          items={accounts}
          defaultValue={receipt?.depositAccount ?? undefined}
        >
          <SelectTrigger id="receipt-account" className="w-full">
            <SelectValue placeholder="選擇帳戶" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.value} value={account.value}>
                {account.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  )
}

export function UploadReceipt({ projects }: { projects: string[] }) {
  const [files, setFiles] = React.useState<File[]>([])

  async function submit(data: FormData) {
    const [file] = files
    if (!file) {
      toast.error("請選檔案")
      throw new Error("no file")
    }
    const pdf = file.type === "application/pdf"
    await report(
      upload({
        name: text(data, "name"),
        project: text(data, "project"),
        depositAccount: text(data, "depositAccount"),
        contentType: pdf ? "application/pdf" : "image/jpeg",
        base64: await base64(pdf ? file : await shrink(file)),
      }),
      "已上傳"
    )
    setFiles([])
  }

  return (
    <FormDialog
      trigger={<Button>上傳</Button>}
      onOpenChange={(open) => open && setFiles([])}
      title="上傳收據"
      submitLabel="上傳"
      onSubmit={submit}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="receipt-file">檔案</Label>
        <FileUpload
          id="receipt-file"
          value={files}
          onValueChange={(next) => setFiles(next.slice(-1))}
          accept="application/pdf,image/jpeg,image/png,image/webp"
          acceptLabel="PDF、JPG、PNG"
          maxSize={LIMIT}
          paste
        />
      </div>
      <Fields projects={projects} />
    </FormDialog>
  )
}

export function ReceiptActions({
  receipt,
  projects,
}: {
  receipt: Receipt
  projects: string[]
}) {
  const done = receipt.status === "approved"
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={done ? "改回審核中" : "完成"}
              onClick={() =>
                report(
                  edit({
                    id: receipt.id,
                    status: done ? "pending" : "approved",
                  }),
                  done ? "已改回審核中" : "已完成"
                ).catch(() => {})
              }
            />
          }
        >
          {done ? <Undo2Icon /> : <CheckIcon />}
        </TooltipTrigger>
        <TooltipContent>{done ? "改回審核中" : "完成"}</TooltipContent>
      </Tooltip>
      <FormDialog
        trigger={
          <Button variant="ghost" size="icon" aria-label="修改">
            <PencilIcon />
          </Button>
        }
        title="修改收據"
        submitLabel="儲存"
        onSubmit={(data) =>
          report(
            edit({
              id: receipt.id,
              name: text(data, "name"),
              project: text(data, "project"),
              depositAccount: text(data, "depositAccount"),
            }),
            "已儲存"
          )
        }
      >
        <Fields receipt={receipt} projects={projects} />
      </FormDialog>
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="icon" aria-label="刪除">
            <Trash2Icon />
          </Button>
        }
        title={`刪除「${receipt.name}」？`}
        confirmLabel="刪除"
        onConfirm={() => report(remove(receipt.id), "已刪除")}
      />
    </>
  )
}
