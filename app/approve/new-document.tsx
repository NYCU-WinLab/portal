"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { createDocument } from "./actions"

export function NewDocument() {
  const router = useRouter()

  async function submit(data: FormData) {
    const file = data.get("file")
    if (!(file instanceof File) || !file.size) {
      toast.error("請選 PDF")
      throw new Error("no file")
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ""
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const { result, error } = await createDocument({
      title: String(data.get("title") ?? ""),
      base64: btoa(binary),
    })
    if (error) {
      toast.error(error)
      throw new Error(error)
    }
    router.push(`/approve/${result!.id}`)
  }

  return (
    <FormDialog
      trigger={<Button>新增文件</Button>}
      title="新增簽核文件"
      submitLabel="新增"
      onSubmit={submit}
    >
      <FormField label="標題" required>
        <Input name="title" maxLength={200} />
      </FormField>
      <FormField label="PDF" required>
        <Input name="file" type="file" accept="application/pdf,.pdf" />
      </FormField>
    </FormDialog>
  )
}
