"use client"

import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"

import { deleteSeriesAction, setSeriesActiveAction } from "./rooms-actions"

export function SeriesButtons({
  id,
  title,
  active,
}: {
  id: string
  title: string
  active: boolean
}) {
  async function toggle() {
    const { error } = await setSeriesActiveAction(id, !active)
    if (error) toast.error(error)
    else toast.success(active ? "已暫停" : "已恢復")
  }

  async function remove() {
    const { error } = await deleteSeriesAction(id)
    if (error) {
      toast.error(error)
      throw new Error(error)
    }
    toast.success("已刪除，已訂好的場次還在")
  }

  return (
    <>
      <Button variant="ghost" onClick={toggle}>
        {active ? "暫停" : "恢復"}
      </Button>
      <ConfirmDialog
        trigger={<Button variant="ghost">刪除</Button>}
        title={`刪除「${title}」？`}
        confirmLabel="刪除"
        onConfirm={remove}
      />
    </>
  )
}
