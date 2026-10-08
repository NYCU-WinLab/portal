"use client"

import { XIcon } from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { revokeAdminAction } from "./actions"

export function RevokeButton({
  userId,
  app,
  name,
  label,
}: {
  userId: string
  app: string
  name: string
  label: string
}) {
  async function revoke() {
    const { error } = await revokeAdminAction({ userId, app })
    if (error) {
      toast.error(error)
      throw new Error(error)
    }
    toast.success("已移除")
  }

  return (
    <Tooltip>
      <ConfirmDialog
        trigger={
          <TooltipTrigger
            render={<Button variant="ghost" size="icon" aria-label="移除" />}
          >
            <XIcon />
          </TooltipTrigger>
        }
        title={`移除 ${name} 的${label}管理員？`}
        confirmLabel="移除"
        onConfirm={revoke}
      />
      <TooltipContent>移除</TooltipContent>
    </Tooltip>
  )
}
