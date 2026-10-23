"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"

import { removeMember } from "../actions"

export function RemoveMember({
  groupId,
  email,
}: {
  groupId: string
  email: string
}) {
  const router = useRouter()
  return (
    <ConfirmDialog
      trigger={<Button variant="ghost">移出</Button>}
      title={`把 ${email} 移出群組？`}
      confirmLabel="移出"
      onConfirm={async () => {
        const { result, error } = await removeMember(groupId, email)
        const detail =
          error ??
          (result && result.status !== "ok" && "detail" in result
            ? result.detail
            : null)
        if (detail) {
          toast.error(detail)
          throw new Error(detail)
        }
        toast.success("已移出，Google 名單幾秒後更新")
        // Google's list catches up a few seconds after the change.
        setTimeout(() => router.refresh(), 4000)
      }}
    />
  )
}
