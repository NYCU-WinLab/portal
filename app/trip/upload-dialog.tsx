"use client"

import * as React from "react"
import { toast } from "sonner"

import { FileUpload } from "@/components/file-upload"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { upload } from "./actions"

const LIMIT = 10 * 1024 * 1024
const MAX_SIDE = 2000

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

// 上傳: PDFs and photos (photos are shrunk here and become PDFs on the
// server), sent one after another with one shared description.
export function UploadDialog({
  tripId,
  trigger = <Button>上傳</Button>,
}: {
  tripId: string
  trigger?: React.ReactElement
}) {
  const [files, setFiles] = React.useState<File[]>([])

  async function submit(data: FormData) {
    if (files.length === 0) {
      toast.error("請選檔案")
      throw new Error("no files")
    }
    const description = String(data.get("description") ?? "")
    let sent = 0
    for (const file of files) {
      const pdf = file.type === "application/pdf"
      const body = pdf ? file : await shrink(file)
      const { error } = await upload({
        tripId,
        filename: file.name,
        contentType: pdf ? "application/pdf" : "image/jpeg",
        base64: await base64(body),
        description,
      })
      if (error) {
        toast.error(`${file.name}：${error}`)
        // Keep what failed and after it for another try.
        setFiles((all) => all.slice(sent))
        throw new Error(error)
      }
      sent += 1
    }
    toast.success(`已上傳 ${sent} 個檔案`)
    setFiles([])
  }

  return (
    <FormDialog
      trigger={trigger}
      onOpenChange={(open) => open && setFiles([])}
      title="上傳"
      submitLabel="上傳"
      onSubmit={submit}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="trip-files">檔案</Label>
        <FileUpload
          id="trip-files"
          value={files}
          onValueChange={setFiles}
          accept="application/pdf,image/jpeg,image/png,image/webp"
          acceptLabel="PDF、JPG、PNG"
          maxSize={LIMIT}
          multiple
          paste
        />
      </div>
      <FormField label="說明">
        <Input name="description" maxLength={200} placeholder="3/14 飯店住宿" />
      </FormField>
    </FormDialog>
  )
}
