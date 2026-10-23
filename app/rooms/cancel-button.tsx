"use client"

import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"

import { cancelBookingAction } from "./actions"

export function CancelButton({ id, title }: { id: string; title: string }) {
  async function cancel() {
    const { result, error } = await cancelBookingAction(id)
    if (error) {
      toast.error(error)
      throw new Error(error)
    }
    if (result!.teams_error)
      toast.warning(
        `已取消，但 Teams 會議沒有關掉（${result!.teams_error}），請到 Teams 刪除`
      )
    else toast.success("已取消，取消通知寄出中")
  }

  return (
    <ConfirmDialog
      trigger={<Button variant="ghost">取消</Button>}
      title={`取消「${title}」？`}
      confirmLabel="取消預約"
      onConfirm={cancel}
    />
  )
}
