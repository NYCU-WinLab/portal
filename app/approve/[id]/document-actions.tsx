"use client"

import { useRouter } from "next/navigation"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { report } from "@/lib/report"

import { deleteDocument, submitDocument } from "../actions"

export function DocumentActions({
  id,
  title,
  mine,
  status,
}: {
  id: string
  title: string
  mine: boolean
  status: string
}) {
  const router = useRouter()
  if (!mine || status === "completed") return null
  return (
    <div className="flex gap-2">
      <ConfirmDialog
        trigger={<Button variant="outline">刪除</Button>}
        title={`刪除「${title}」？`}
        confirmLabel="刪除"
        onConfirm={async () => {
          await report(deleteDocument(id), "已刪除")
          router.push("/approve")
        }}
      />
      {status === "draft" && (
        <ConfirmDialog
          trigger={<Button>送出</Button>}
          title="送出後會寄信請簽核人簽，之後不能再改欄位"
          confirmLabel="送出"
          variant="default"
          onConfirm={async () => {
            await report(submitDocument(id), "已送出")
            router.push("/approve")
          }}
        />
      )}
    </div>
  )
}
