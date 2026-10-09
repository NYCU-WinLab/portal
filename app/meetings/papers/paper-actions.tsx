"use client"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { paperAdd, paperDelete, paperUpdate } from "../actions"
import { report } from "../report"

type Paper = {
  id: string
  title: string
  url: string | null
  venue: string | null
}

const read = (data: FormData) => ({
  title: String(data.get("title") ?? ""),
  url: String(data.get("url") ?? ""),
  venue: String(data.get("venue") ?? ""),
})

export function PaperDialog({ paper }: { paper?: Paper }) {
  return (
    <FormDialog
      trigger={
        paper ? <Button variant="ghost">編輯</Button> : <Button>新增</Button>
      }
      title={paper ? "編輯論文" : "新增論文"}
      submitLabel={paper ? "儲存" : "新增"}
      onSubmit={(data) =>
        paper
          ? report(paperUpdate({ id: paper.id, ...read(data) }), "已儲存")
          : report(paperAdd(read(data)), "已新增")
      }
    >
      <FormField label="標題" required>
        <Input name="title" defaultValue={paper?.title} maxLength={300} />
      </FormField>
      <FormField label="連結">
        <Input name="url" type="url" defaultValue={paper?.url ?? ""} />
      </FormField>
      <FormField label="出處">
        <Input
          name="venue"
          defaultValue={paper?.venue ?? ""}
          placeholder="NSDI'24"
          maxLength={50}
        />
      </FormField>
    </FormDialog>
  )
}

export function PaperRowActions({ paper }: { paper: Paper }) {
  return (
    <div className="flex shrink-0 gap-2">
      <PaperDialog paper={paper} />
      <ConfirmDialog
        trigger={<Button variant="ghost">刪除</Button>}
        title={`刪除「${paper.title}」？`}
        confirmLabel="刪除"
        onConfirm={() => report(paperDelete({ id: paper.id }), "已刪除")}
      />
    </div>
  )
}
