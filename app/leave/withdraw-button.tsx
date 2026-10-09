"use client"

import { Undo2Icon } from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { deleteLeaveAction } from "./actions"

export function WithdrawButton({
  date,
  label,
}: {
  date: string
  label: string
}) {
  async function withdraw() {
    const { error } = await deleteLeaveAction(date)
    if (error) {
      toast.error(error)
      throw new Error(error)
    }
    toast.success("已撤回")
  }

  return (
    <Tooltip>
      <ConfirmDialog
        trigger={
          <TooltipTrigger
            render={<Button variant="ghost" size="icon" aria-label="撤回" />}
          >
            <Undo2Icon />
          </TooltipTrigger>
        }
        title={`撤回 ${label} 的請假？`}
        confirmLabel="撤回"
        onConfirm={withdraw}
      />
      <TooltipContent>撤回</TooltipContent>
    </Tooltip>
  )
}
