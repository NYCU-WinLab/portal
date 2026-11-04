"use client"

import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { report } from "@/lib/report"

import { rotateFeedsAction } from "./actions"

export function FeedLink({ url }: { url: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success("已複製訂閱連結")
    } catch {
      toast.error("複製失敗，請手動選取")
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        readOnly
        value={url}
        aria-label="訂閱連結"
        className="min-w-0 flex-1"
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button onClick={copy}>複製</Button>
    </div>
  )
}

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
