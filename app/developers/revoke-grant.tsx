"use client"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { report } from "@/lib/report"

import { revokeGrant } from "./actions"

export function RevokeGrant({ id, app }: { id: string; app: string }) {
  return (
    <ConfirmDialog
      trigger={<Button variant="ghost">撤銷</Button>}
      title={`撤銷給「${app}」的授權？`}
      confirmLabel="撤銷"
      onConfirm={() => report(revokeGrant(id), "已撤銷")}
    />
  )
}
