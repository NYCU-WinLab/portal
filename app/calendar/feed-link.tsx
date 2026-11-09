"use client"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { report } from "@/lib/report"

import { rotateFeedsAction } from "./actions"

/** Ends every subscription link the member handed out, for one that leaked. */
export function RotateFeeds() {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" className="self-start">
          重設所有訂閱連結
        </Button>
      }
      title="重設後，舊的訂閱連結都會停止更新"
      confirmLabel="重設"
      onConfirm={() => report(rotateFeedsAction(), "已重設")}
    />
  )
}
